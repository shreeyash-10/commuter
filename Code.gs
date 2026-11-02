/** Commute Monitor. Configure secrets and locations in Script Properties. */
const MONITOR = Object.freeze({timezone: 'Asia/Kolkata', monthlyCap: 1500, checks: 1, travelMode: 'TWO_WHEELER'});

function installTrigger() {
  config_(); // Refuse activation until all required properties are present.
  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'checkTraffic');
  if (!triggers.length) ScriptApp.newTrigger('checkTraffic').timeBased().everyMinutes(5).create();
  triggers.slice(1).forEach(t => ScriptApp.deleteTrigger(t));
  console.log('Commute monitoring enabled: every 5 minutes, weekdays 09:45–11:00 and 18:30–19:45 IST.');
}

function uninstallTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'checkTraffic')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function checkTraffic() {
  const now = new Date();
  const window = window_(now);
  if (!window) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const day = Utilities.formatDate(now, MONITOR.timezone, 'yyyy-MM-dd');
    const key = 'STATE_' + window;
    let state = JSON.parse(props.getProperty(key) || '{}');
    if (state.day !== day || state.mode !== MONITOR.travelMode)
      state = {day: day, mode: MONITOR.travelMode, streak: 0, sent: false};
    if (state.sent) return;
    const cfg = config_();
    const route = route_(cfg, window);
    let seconds;
    try { seconds = duration_(route.from, route.to, cfg.key, now); }
    catch (error) {
      state.streak = 0;
      props.setProperty(key, JSON.stringify(state));
      throw error;
    }
    const fresh = state.last && now.getTime() - state.last <= 10 * 60 * 1000;
    state.streak = seconds < route.threshold * 60 ? (fresh ? state.streak : 0) + 1 : 0;
    state.last = now.getTime();
    state.etaSeconds = seconds;
    console.log(JSON.stringify({period:window, mode:MONITOR.travelMode, etaSeconds:seconds,
      thresholdMinutes:route.threshold, streak:state.streak}));
    // Persist the reading even if Discord delivery fails; later checks can retry.
    props.setProperty(key, JSON.stringify(state));
    if (state.streak >= MONITOR.checks) {
      discord_(cfg.webhook, message_(window, route, seconds));
      state.sent = true;
      props.setProperty(key, JSON.stringify(state));
    }
  } finally { lock.releaseLock(); }
}

function testGoogleMaps() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) throw new Error('Another check is running; try again.');
  try {
    const cfg = config_();
    const seconds = duration_(cfg.a, cfg.b, cfg.key, new Date());
    console.log('Morning route ETA: ' + Math.round(seconds / 60) + ' minutes.');
  } finally { lock.releaseLock(); }
}

function testDiscord() {
  discord_(config_().webhook, '✅ Commute Monitor test: Discord delivery works.');
}

function validateConfiguration() {
  config_();
  console.log('Required Script Properties are configured. No API request sent.');
}

function config_() {
  const p = PropertiesService.getScriptProperties().getProperties();
  ['LOCATION_A', 'LOCATION_B', 'MAPS_API_KEY', 'DISCORD_WEBHOOK_URL'].forEach(k => {
    if (!p[k] || !p[k].trim()) throw new Error('Missing Script Property: ' + k);
  });
  const morning = Number(p.MORNING_THRESHOLD_MIN || 24);
  const evening = Number(p.EVENING_THRESHOLD_MIN || 27);
  if (![morning, evening].every(n => Number.isFinite(n) && n > 0))
    throw new Error('Thresholds must be positive numbers of minutes.');
  if (!/^https:\/\/(?:canary\.|ptb\.)?discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(p.DISCORD_WEBHOOK_URL))
    throw new Error('DISCORD_WEBHOOK_URL must be a Discord webhook URL.');
  return {a:p.LOCATION_A.trim(), b:p.LOCATION_B.trim(), key:p.MAPS_API_KEY.trim(),
    webhook:p.DISCORD_WEBHOOK_URL, morning:morning, evening:evening};
}

function window_(now) {
  const weekday = Utilities.formatDate(now, MONITOR.timezone, 'EEE');
  if (weekday === 'Sat' || weekday === 'Sun') return null;
  const hour = Number(Utilities.formatDate(now, MONITOR.timezone, 'H'));
  const minute = Number(Utilities.formatDate(now, MONITOR.timezone, 'm'));
  const minutes = hour * 60 + minute;
  return minutes >= 585 && minutes < 660 ? 'morning'
    : minutes >= 1110 && minutes < 1185 ? 'evening' : null;
}

function route_(cfg, window) {
  return window === 'morning' ? {from:cfg.a, to:cfg.b, threshold:cfg.morning}
    : {from:cfg.b, to:cfg.a, threshold:cfg.evening};
}

function duration_(from, to, key, now) {
  const props = PropertiesService.getScriptProperties();
  const month = Utilities.formatDate(now, MONITOR.timezone, 'yyyy-MM');
  const saved = JSON.parse(props.getProperty('MAPS_USAGE') || '{}');
  const used = saved.month === month ? Number(saved.count) : 0;
  if (!Number.isInteger(used) || used < 0) throw new Error('Invalid MAPS_USAGE state.');
  if (used >= MONITOR.monthlyCap) throw new Error('Monthly Maps request safety cap reached.');
  // Count before sending: failed requests and manual tests also consume the cap.
  props.setProperty('MAPS_USAGE', JSON.stringify({month:month, count:used + 1}));
  const response = UrlFetchApp.fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method:'post', contentType:'application/json', muteHttpExceptions:true,
    headers:{'X-Goog-Api-Key':key, 'X-Goog-FieldMask':'routes.duration'},
    payload:JSON.stringify({origin:{address:from}, destination:{address:to},
      travelMode:MONITOR.travelMode, routingPreference:'TRAFFIC_AWARE_OPTIMAL'})
  });
  if (response.getResponseCode() !== 200) throw new Error('Routes API HTTP ' + response.getResponseCode());
  const data = JSON.parse(response.getContentText());
  const duration = data.routes && data.routes[0] && data.routes[0].duration;
  if (typeof duration !== 'string' || !/^\d+(?:\.\d+)?s$/.test(duration))
    throw new Error('Routes API returned no valid duration.');
  return Number(duration.slice(0, -1));
}

function message_(window, route, seconds) {
  const url = 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(route.from)
    + '&destination=' + encodeURIComponent(route.to) + '&travelmode=two-wheeler';
  return '🚗 **' + window.toUpperCase() + ' COMMUTE ALERT**\n'
    + '**Mode:** Two-wheeler\n'
    + '**Current ETA:** ' + Math.floor(seconds / 60) + 'm ' + Math.floor(seconds % 60) + 's\n'
    + '**Threshold:** Under ' + route.threshold + ' min\n[Open directions](<' + url + '>)\nTwo-wheeler routes are in beta; use caution.';
}

function discord_(webhook, content) {
  // wait=true requests delivery acknowledgement. Avoid retries within one execution.
  const response = UrlFetchApp.fetch(webhook + '?wait=true', {
    method:'post', contentType:'application/json', muteHttpExceptions:true,
    payload:JSON.stringify({content:content, allowed_mentions:{parse:[]}})
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error('Discord delivery HTTP ' + status);
}
