/**
 * This file is part of StoveLabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

 'use strict'

/**
 * Setup
 */

// User configurations
const config = require('./config.json');

// Modules
const crypto = require('crypto');
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const handlebars = require('express-handlebars');
const sqlite3 = require('sqlite3');
const tmi = require('tmi.js');
const { URLSearchParams } = require('url');

// Set up the Express application
const app = express();
app.engine('handlebars', handlebars());
app.set('view engine', 'handlebars');
app.use(express.json({ verify: verifyRequest }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Create the HTTP server
const http = function() {
  if (config.ssl.enabled) {
    const options = {
      key: fs.readFileSync(config.ssl.keyfile),
      cert: fs.readFileSync(config.ssl.cert),
      ca: fs.readFileSync(config.ssl.cafile)
    };

    return require('https').createServer(options, app);
  } else {
    return require('http').Server(app);
  }
}();

// Create the socket
const io = require('socket.io')(http);

// Webhook creation function
const whCreateFuncs = {
  stream: setStreamWebhook,
  follows: setFollowsWebhook
};

// Timeout handles
const whTimeouts = {
  stream: 0,
  follows: 0
};

// Set of processed wenhook notification IDs
const whProcessed = new Set();

// Construct the base URL for the application
config.url = `${config.ssl.enabled ? 'https' : 'http'}://${config.host}:${config.port}`;

// Runtime user configuration
const runtimeConfig = {
  user_id: 0,
  live: false
};

// Timer variables
let timerPos = 0;
let nextTimer = Infinity;
let chatLines = 0;

// Create the data directory
try {
  fs.mkdirSync('./data');
} catch {
  // Do nothing; directory probably exists
}

const settings = {};
const alerts = {};
const commands = {};
const timers = [];
const schedule = [];
const sfx = {};

// Chat command functions
const chatCommands = {
  say: (user, args, resolve, reject) => {
    resolve(args.join(' '));
  },
  sfx: (user, args, resolve, reject) => {
    if (sfx[args[0]] === undefined) {
      reject();

      return;
    }

    io.emit('sfx', args[0]);

    resolve();
  },
  tip: (user, args, resolve, reject) => {
    db.get('SELECT id, message FROM tips ORDER BY RANDOM() LIMIT 1', (err, row) => {
      if (err) {
        console.warn('error getting tip data');
        console.log(err);

        reject();

        return;
      }

      if (row) {
        resolve(`TIP #${row.id}: ${row.message}`);
      } else {
        resolve(`Sorry, ${user}, we're all out of tips!`);
      }
    });
  },
  addtip: (user, args, resolve, reject) => {
    const message = args.join(' ');

    if (message.length < 2) {
      reject(`${user} Your tip message is too short (2 characters min, yours was ${message.length})`);
    } else if (message.length > 80) {
      reject(`${user} Your tip message is too long (80 characters max, yours was ${message.length})`);
    } else {
      db.run('INSERT INTO tips (date, user, message) VALUES (?, ?, ?)', Date.now(), user, message, function (err) {
        if (err) {
          console.warn('error saving tip data');
          console.log(err);

          reject();

          return;
        }

        resolve(`Tip #${this.lastID} has been added to the list`);
      });
    }
  }
};

// Create the database connection
const db = new sqlite3.Database('./data/stovelabs.db', err => {
  if (err) {
    console.warn('database connection failed');
    console.log(err);

    return;
  }

  db.serialize(() => {
    db.run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)')
      .all('SELECT key, value FROM settings', (err, rows) => {
        if (err) {
          console.warn('error loading settings from the database');
          console.log(err);

          return;
        }

        rows.forEach(row => {
          settings[row.key] = row.value
        });

        if (!settings.secret) {
          settings.secret = crypto.randomBytes(64).toString('hex');
        }

        checkUser()
        .then(valid => {
          if (valid) {
            setWebhooks();
            checkStream();
            setupHttpRoutes();
            setupTwitchClients();
          } else {
            console.log('invalid oauth2 tokens');
          }
        });

        db.serialize(() => {
          db.run('CREATE TABLE IF NOT EXISTS alerts (key TEXT PRIMARY KEY, message TEXT, graphic TEXT, sound TEXT, duration INTEGER NOT NULL DEFAULT 5)')
            .prepare('INSERT OR IGNORE INTO alerts (key, message) VALUES (?, ?)')
            .run('cheer', '${user} cheered ${amount} bits!')
            .run('follower', '${user} is now following!')
            .run('subscription', '${user} has subscribed!')
            .run('resub', '${user} has resubscribed for ${months} months!')
            .run('subgift', '${user} gifted a subscription to ${recipient}!')
            .run('submysterygift', '${user} gifted subscriptions to ${subcount} lucky viewers!')
            .run('raid', '${user} raided the channel with ${viewers} viewers!')
            .run('host', '${user} hosted the channel with ${viewers} viewers!')
            .run('charitydonation', '${user} donated ${amount} to charity!')
            .finalize()
            .all('SELECT key, message, graphic, sound, duration FROM alerts', (err, rows) => {
              if (err) {
                console.warn('error loading alerts from the database');
                console.log(err);

                return;
              }

              rows.forEach(row => {
                alerts[row.key] = {
                  message: row.message,
                  graphic: row.graphic,
                  sound: row.sound,
                  duration: row.duration
                };
              });

              for (const key in alerts) {
                const alert = alerts[key];
                if (alert.graphic) {
                  const ext = alert.graphic.substring(alert.graphic.lastIndexOf('.') + 1).toLowerCase();
                  switch (ext) {
                    case 'mp4':
                    case 'mov':
                    case 'webm':
                      alert.video = alert.graphic;
                      break;
                    default:
                      alert.image = alert.graphic;
                  }
                }

                alert.message = alert.message.replace(/\$\{([a-z]+)\}/gi, '<span class="$1"></span>');
              }
            });
        });

        db.serialize(() => {
          db.run('CREATE TABLE IF NOT EXISTS commands (key TEXT PRIMARY KEY, level INTEGER, user_timeout INTEGER, global_timeout INTEGER, aliases TEXT, command TEXT)')
            .all('SELECT key, level, user_timeout, global_timeout, aliases, command FROM commands', (err, rows) => {
              if (err) {
                console.warn('error loading commands from the database');
                console.log(err);

                return;
              }

              rows.forEach(row => {
                commands[row.key] = {
                  level: row.level,
                  user_timeout: row.user_timeout,
                  global_timeout: row.global_timeout,
                  aliases: row.aliases.split(','),
                  command: row.command
                };
              });

              for (const k in commands) {
                for (const k2 in commands[k].aliases) {
                  commands[commands[k].aliases[k2]] = commands[k];
                }

                commands[k].timeouts = {
                  global: 0,
                  user: {}
                };
              }
            });
        });

        db.serialize(() => {
          db.run('CREATE TABLE IF NOT EXISTS timers (id INTEGER PRIMARY KEY AUTOINCREMENT, pos INTEGER, message TEXT)')
            .all('SELECT message FROM timers ORDER BY pos', (err, rows) => {
              if (err) {
                console.warn('error loading timers from the database');
                console.log(err);

                return;
              }

              rows.forEach(row => timers.push(row.message));

              nextTimer = Date.now() + settings.timer_timeout * 1000;
            });
        });

        db.serialize(() => {
          db.run('CREATE TABLE IF NOT EXISTS schedule (id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER, hour INTEGER, minute INTEGER, length INTEGER, game TEXT)')
            .all('SELECT day, hour, minute, length, game FROM schedule ORDER BY day, hour, minute, length', (err, rows) => {
              if (err) {
                console.warn('error loading schedule from the database');
                console.log(err);

                return;
              }

              rows.forEach(row => schedule.push(row));
            });
        });

        db.serialize(() => {
          db.run('CREATE TABLE IF NOT EXISTS sfx (key TEXT PRIMARY KEY, file TEXT)')
            .all('SELECT key, file FROM sfx', (err, rows) => {
              if (err) {
                console.warn('error loading sfx from the database');
                console.log(err);

                return;
              }

              rows.forEach(row => {
                sfx[row.key] = {
                  file: row.file
                };
              });
            });
        });

        db.run('CREATE TABLE IF NOT EXISTS tips (id INTEGER PRIMARY KEY AUTOINCREMENT, date INTEGER, user TEXT, message TEXT)');
      });
    });
  });

// Start listening to HTTP requests
http.listen(config.port, config.host, () => {
  console.log(`listening on ${config.host}:${config.port}`);
  console.log(`overlay url: ${config.url}/overlay`);
});

// Set up timers
setInterval(() => {
  if (!timers || !runtimeConfig.live || chatLines < settings.timer_chat_lines || Date.now() < nextTimer) {
    return;
  }

  bot.say(settings.twitch_channel_username, timers[timerPos]);
  timerPos = (timerPos + 1) % timers.length;
  nextTimer = Date.now() + settings.timer_timeout * 1000;
  chatLines = 0;
}, 1000);

/**
 * Set up HTTP server routes.
 */
function setupHttpRoutes() {
  // Index page; shows the Twitch auth link
  app.get('/', (req, res) => {
    const params = {};
    if (settings.oauth_access_token) {
      if (config.debug) {
        params.alerts = alerts;
      }
    } else {
      params.connectUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${settings.twitch_api_client}&redirect_uri=${config.url}/cb&response_type=code&scope=user:read:email`;
    }

    res.render('index', params);
  });

  // The Twitch auth callback
  app.get('/cb', (req, res) => {
    if (!req.query.code) {
      res.status(400).end();
      return;
    }

    const url = `https://id.twitch.tv/oauth2/token?client_id=${settings.twitch_api_client}&client_secret=${settings.twitch_api_secret}&code=${req.query.code}&grant_type=authorization_code&redirect_uri=${config.url}/cb`;

    fetch(url, {
      method: 'POST'
    })
    .then(res => res.json())
    .then(auth => {
      settings.oauth_access_token = auth.access_token;
      settings.oauth_refresh_token = auth.refresh_token;
      checkUser()
      .then(valid => {
        if (valid) {
          saveConfig();
          setWebhooks();
          checkStream();
        }
      });
    })
    .catch(err => {
      console.warn('failed to authenticate with Twitch');
      console.log(err);
    })
    .finally(() => res.redirect('/'));
  });

  // The webhook registration callback
  app.get('/wh/:cb', (req, res) => {
    if (req.query['hub.challenge'] && req.query['hub.mode']) {
      console.log(`${req.params.cb} webhook subscription ${req.query['hub.mode']}ed successfully`);
      if (req.query['hub.mode'] === 'subscribe') {
        if (req.query['hub.lease_seconds']) {
          whTimeouts[req.params.cb] = setTimeout(whCreateFuncs[req.params.cb], req.query['hub.lease_seconds'] * 1000);
        }
      } else {
        clearTimeout(whTimeouts[req.params.cb]);
      }

      res.send(req.query['hub.challenge']);
    }
  });

  // The webhook callback
  app.post('/wh/:cb', (req, res) => {
    if (!req.verified) {
      res.sendStatus(403).end();
      return;
    }

    if (!req.headers['twitch-notification-id'] || whProcessed.has(req.headers['twitch-notification-id'])) {
      req.end();
      return;
    }

    switch (req.params.cb) {
      case 'stream':
        runtimeConfig.live = req.body.data && req.body.data.length > 0;
        console.log(`channel is ${runtimeConfig.live ? 'LIVE!' : 'offline'}`);

        break;
      case 'follows':
        if (req.body.data) {
          for (let i = req.body.data.length - 1; i >= 0; i--) {
            sendAlert('follower', {
              user: req.body.data[i].from_name
            });
          };
        }

        break;
    }

    whProcessed.add(req.headers['twitch-notification-id']);

    res.end();
  });

  // The overlay page
  app.get('/overlay', (req, res) => {
    const options = {
      layout: false,
      config: { }
    };

    if (req.query.alerts) {
      options.alerts = alerts;
      options.config.alerts = true;
      options.config.donordrive = {
        instance: settings.donordrive_instance,
        participant: settings.donordrive_participant,
        alertduration: alerts.charitydonation.duration * 1000
      };
    }

    if (req.query.countdown) {
      options.countdown = true;
      options.config.schedule = schedule;
    }

    if (req.query.nextstream) {
      options.nextstream = true;
      options.config.schedule = schedule;
    }

    if (req.query.sfx) {
      options.sfx = sfx;
      options.config.sfx = true;
    }

    new Promise((resolve, reject) => {
      if (req.query.tips) {
        options.config.tips = [];
        options.tips = true;
        db.all('SELECT message FROM tips ORDER BY RANDOM() LIMIT 50', (err, rows) => {
          if (err) {
            console.warn('error loading tip data');
            console.log(err);

            return;
          }

          rows.forEach(row => {
            options.config.tips.push(row.message);
          });

          resolve();
        });
      } else {
        resolve();
      }
    })
    .then(() => {
      options.config = JSON.stringify(options.config);
      res.render('overlay', options);
    });
  });

  // The form action for the test buttons
  app.post('/test', (req, res) => {
    if (!config.debug) {
      res.sendStatus(403).end();
      return;
    }

    if (req.body.alert) {
      sendAlert(req.body.type, req.body);
    }

    res.redirect('/');
  });
}

/**
 * Set up Twitch chat clients.
 */
function setupTwitchClients() {
  // Create the client that listens to the stream channel
  const host = new tmi.Client({
    connection: {
      secure: true,
      reconnect: true
    },
    identity: {
      username: settings.twitch_channel_username,
      password: settings.twitch_channel_password
    },
    channels: [ `#${settings.twitch_channel_username}` ]
  });

  // Connect to the channel
  host.connect()
  .then(() => {
    console.log('connected to Twitch channel');
  }).catch(err => {
    console.warn('failed to connect to Twitch channel');
    console.log(err);
  });

  // Create the client that sends messages via the bot user
  const bot = new tmi.Client({
    connection: {
      secure: true,
      reconnect: true
    },
    identity: {
      username: settings.twitch_bot_username,
      password: settings.twitch_bot_password
    }
  });

  // Connect to the bot
  bot.connect()
  .then(() => {
    console.log('connected to Twitch bot channel');
  }).catch(err => {
    console.warn('failed to connect to Twitch bot channel');
    console.log(err);
  });

  /**
   * Hook channel events
   */

  // Chat message
  host.on('chat', (channel, userstate, message, self) => {
    if (userstate.username === settings.twitch_bot_username) {
      return;
    }

    chatLines++;

    if (message[0] !== '!') {
      return;
    }

    console.log(`${userstate.username}: ${message}`);

    let command = false;
    for (const key in commands) {
      if (key === message.substr(1, key.length)) {
        command = commands[key];
      }
    }

    if (!command) {
      return;
    }

    if (Date.now() < Math.max(command.timeouts.global, command.timeouts.user[userstate.username] || 0)) {
      return;
    }

    let level = 0;
    if (`#${userstate.username}` === channel) {
      level = 3;
    } else if (userstate.mod) {
      level = 2;
    } else if (userstate.subscriber) {
      level = 1;
    }

    if (level < command.level) {
      return;
    }

    const params = message.trim().substring(1).split(/\s+/);
    let parsed = command.command.replace(/\$\{(\d+)(\:(\d*))?\}/g, (match, start, range, end) => {
      if (range) {
        if (end) {
          if (end >= 0) {
            end++;
          }

          return params.slice(start, end).join(' ');
        }

        return params.slice(start).join(' ');
      }

      return params[start];
    });

    parsed = parsed.replace(/\$\{([a-z][0-9a-z]*)(?: (.+?))?\}/gi, (match, fn, p) => {
      switch (fn) {
        case 'user':
          return userstate['display-name'];
        case 'channel':
          return p.toLowerCase();
        default:
          return match;
      }
    });

    parsed = parsed.split(/\s+/);
    if (!parsed.length || chatCommands[parsed[0]] === undefined) {
      return;
    }

    new Promise((resolve, reject) => {
      chatCommands[parsed[0]](userstate.username, parsed.slice(1), resolve, reject);
    })
    .then(response => {
      if (response.length) {
        bot.say(channel, response);
      }

      command.timeouts.global = Date.now() + command.global_timeout * 1000;
      command.timeouts.user[userstate.username] = Date.now() + command.user_timeout * 1000;
    })
    .catch(response => {
      if (response.length) {
        bot.say(channel, response);
      }
    });
  });

  // Cheer event
  host.on('cheer', (channel, userstate, message) => {
    sendAlert('cheer', {
      user: userstate['display-name'],
      amount: userstate.bits,
      message: message
    });
  });

  // New subscriber event
  host.on('subscription', (channel, username, method, message, userstate) => {
    sendAlert('subscription', {
      user: userstate['display-name'],
      message: message
    });
  });

  // User renews anonymous gift subscription event
  host.on('anongiftpaidupgrade', (channel, username, userstate) => {
    sendAlert('subscription', {
      user: userstate['display-name']
    });
  });

  // User renews gift subscription event
  host.on('giftpaidupgrade', (channel, username, sender, userstate) => {
    sendAlert('subscription', {
      user: userstate['display-name']
    });
  });

  // User renews subscription event
  host.on('resub', (channel, username, months, message, userstate, methods) => {
    sendAlert('resub', {
      user: userstate['display-name'],
      months: months,
      message: message
    });
  });

  // User gifts subscription to user event
  host.on('subgift', (channel, username, streakMonths, recipient, methods, userstate) => {
    sendAlert('subgift', {
      user: userstate['display-name'],
      recipient: recipient
    });
  });

  // User gifts subscriptions to random users event
  host.on('submysterygift', (channel, username, numbOfSubs, methods, userstate) => {
    sendAlert('submysterygift', {
      user: userstate['display-name'],
      subcount: numbOfSubs
    });
  });

  // Raid event
  host.on('raided', (channel, username, viewers) => {
    sendAlert('raid', {
      user: username,
      viewers: viewers
    });
  });

  // Host event
  host.on('hosted', (channel, username, viewers, autohost) => {
    if (autohost) {
      return;
    }

    sendAlert('host', {
      user: username,
      viewers: viewers
    });
  });
}

/**
 * Functions
 */

/**
 * Send a new alert to the overlay page.
 *
 * @param {string} type The type of alert to send
 * @param {object} params The alert parameters
 */
function sendAlert(type, params) {
  const alert = alerts[type];

  if ((!alert.message && !alert.graphic && !alert.sound) || !alert.duration) {
    return;
  }

  const duration = Math.max(1, alert.duration) * 1000;

  io.emit('alert', type, params, duration);
  console.log(`alert sent: ${type}`);
}

/**
 * Query the Twitch API.
 *
 * @param {string} url The URL to query
 * @param {string} method GET or POST
 * @param {object} body Object to send as the JSON body
 */
function apiRequest(url, method, body) {
  return new Promise((resolve, reject) => {
    if (!settings.oauth_access_token) {
      reject('api request failed due to missing access token');
      return;
    }

    const options =  {
      method: method,
      headers: {
        'Client-ID': settings.twitch_api_client,
        'Authorization': `Bearer ${settings.oauth_access_token}`
      }
    };

    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    fetch(url, options)
      .then(res => {
        if (res.status === 401) {
          if (!settings.oauth_refresh_token) {
            reject('api request failed due to invalid or expired access token');
            return;
          }

          fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: settings.oauth_refresh_token,
              client_id: settings.twitch_api_client,
              client_secret: settings.twitch_api_secret
            })
          })
          .then(res => res.json())
          .then(json => {
            if (json.access_token) {
              settings.oauth_access_token = json.access_token;
              settings.oauth_refresh_token = json.refresh_token;

              options.headers['Authorization'] = `Bearer ${settings.oauth_access_token}`;

              fetch(url, options)
              .then(res => resolve(res));
            } else {
              settings.oauth_access_token = '';
              settings.oauth_refresh_token = '';

              reject('failed to refresh token');
            }
          })
          .finally(() => {
            saveConfig();
          });
        } else {
          resolve(res);
        }
      })
      .catch(reject);
  });
}

/**
 * Create or destroy all webhooks.
 *
 * @param {bool} enable Whether to enable the webhooks
 */
function setWebhooks(enable = true) {
  setStreamWebhook(enable);
  setFollowsWebhook(enable);
}

/**
 * Create or destroy the stream webhook.
 * This webhook notifies us of changes to the stream.
 *
 * @param {bool} enable Whether to enable the webhook
 */
function setStreamWebhook(enable = true) {
  setWebhook(`https://api.twitch.tv/helix/streams?user_id=${runtimeConfig.user_id}`, 'stream', enable);

  if (!enable) {
    clearTimeout(streamWhTimeout);
  }
}

/**
 * Create or destroy the follows webhook.
 * This webhook notifies us of new followers.
 *
 * @param {bool} enable Whether to enable the webhook
 */
function setFollowsWebhook(enable = true) {
  setWebhook(`https://api.twitch.tv/helix/users/follows?first=1&to_id=${runtimeConfig.user_id}`, 'follows', enable);

  if (!enable) {
    clearTimeout(followWhTimeout);
  }
}

/**
 * Subscribe or unsubscribe to a Twitch webhook.
 *
 * @param {string} topic The topic to which to subscribe or unsubscribe
 * @param {string} cb The name of the callback
 * @param {bool} enable Whether to enable the webhook
 */
function setWebhook(topic, cb, enable) {
  apiRequest('https://api.twitch.tv/helix/webhooks/hub', 'POST', {
    'hub.callback': `${config.url}/wh/${cb}`,
    'hub.mode': enable ? 'subscribe' : 'unsubscribe',
    'hub.topic': topic,
    'hub.lease_seconds': 86400,
    'hub.secret': settings.secret
  })
  .catch(err => {
    console.warn(`failed to ${enable ? 'create' : 'destroy'} stream webhook subscription`);
    console.log(err);
  });
}

/**
 * Save the configuration to the database.
 */
function saveConfig() {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

  for (const key in settings) {
    stmt.run(key, settings[key]);
  }

  stmt.finalize();
}

/**
 * Verify authentication tokens and load user data.
 */
function checkUser() {
  return new Promise((resolve, reject) => {
    if (!settings.oauth_access_token) {
      resolve(false);
      return;
    }

    apiRequest('https://api.twitch.tv/helix/users', 'GET')
    .then(res => res.json())
    .then(user => {
      if (user.data && user.data[0] && user.data[0].login === settings.twitch_channel_username) {
        runtimeConfig.user_id = user.data[0].id;

        console.log(`authenticated with Twitch as user ${ user.data[0].login}`);

        resolve(true);
      } else {
        settings.oauth_access_token = '';
        settings.oauth_refresh_token = '';
        runtimeConfig.user_id = 0;

        saveConfig();

        resolve(false);
      }
    })
    .catch(err => {
      console.warn('api request for user data failed');
      console.log(err);
      resolve(false);
    });
  });
}

/**
 * Update the current status of the stream.
 */
function checkStream() {
  if (!runtimeConfig.user_id) {
    return;
  }

  apiRequest(`https://api.twitch.tv/helix/streams?user_id=${runtimeConfig.user_id}`, 'GET')
  .then(res => res.json())
  .then(chan => {
    runtimeConfig.live = chan.data && chan.data.length > 0;
    console.log(`channel is ${runtimeConfig.live ? 'LIVE!' : 'offline'}`);
  })
  .catch(err => {
    console.warn('api request for channel data failed');
    console.log(err);
  });
}

/**
 * Verify a signed request.
 *
 * @param {express.Request} req The request object
 * @param {express.response} res The response object
 * @param {Buffer} buf Buffer containing the raw request body
 * @param {string} encoding The encoding of the request
 */
function verifyRequest(req, res, buf, encoding) {
  req.verified = false;
  if (req.headers['x-hub-signature']) {
    const hash = crypto.createHmac('sha256', settings.secret).update(buf).digest('hex');
    req.verified = req.headers['x-hub-signature'] === `sha256=${hash}`;
  }
}
