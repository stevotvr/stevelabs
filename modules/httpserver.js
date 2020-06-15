/**
 * This file is part of StoveLabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

const crypto = require('crypto');
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const handlebars = require('express-handlebars');

/**
 * Provides HTTP server functionality.
 */
class HttpServer {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    this.app = app;

    // Set of processed webhook notification IDs
    this.whProcessed = new Set();

    // Map of webhook creation functions
    this.whCreateFuncs = {
      stream: app.api.setStreamWebhook,
      follows: app.api.setFollowsWebhook
    };

    // Set up the Express application
    this.express = express();
    this.express.engine('handlebars', handlebars());
    this.express.set('view engine', 'handlebars');
    this.express.use(express.json({ verify: this.verifyRequest }));
    this.express.use(express.urlencoded({ extended: true }));
    this.express.use(express.static('public'));

    // Create the HTTP server
    const http = (() => {
      if (app.config.ssl.enabled) {
        const options = {
          key: fs.readFileSync(app.config.ssl.keyfile),
          cert: fs.readFileSync(app.config.ssl.cert),
          ca: fs.readFileSync(app.config.ssl.cafile)
        };

        return require('https').createServer(options, this.express);
      } else {
        return require('http').Server(this.express);
      }
    })();

    // Create the socket
    this.io = require('socket.io')(http);

    // Start listening to HTTP requests
    http.listen(app.config.port, app.config.host, () => {
      console.log(`listening on ${app.config.host}:${app.config.port}`);
      console.log(`overlay url: ${app.config.url}/overlay`);
    });
  }

  /**
   * Set up HTTP server routes.
   */
  setupHttpRoutes() {
    const http = this;
    const app = this.app;

    // Index page; shows the Twitch auth link
    this.express.get('/', (req, res) => {
      const params = {};
      if (app.settings.oauth_access_token) {
        if (app.config.debug) {
          params.alerts = app.alerts;
        }
      } else {
        params.connectUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${app.settings.twitch_api_client}&redirect_uri=${app.config.url}/cb&response_type=code&scope=user:read:email`;
      }

      res.render('index', params);
    });

    // The Twitch auth callback
    this.express.get('/cb', (req, res) => {
      if (!req.query.code) {
        res.status(400).end();
        return;
      }

      const url = `https://id.twitch.tv/oauth2/token?client_id=${app.settings.twitch_api_client}&client_secret=${app.settings.twitch_api_secret}&code=${req.query.code}&grant_type=authorization_code&redirect_uri=${app.config.url}/cb`;

      fetch(url, {
        method: 'POST'
      })
      .then(res => res.json())
      .then(auth => {
        app.settings.oauth_access_token = auth.access_token;
        app.settings.oauth_refresh_token = auth.refresh_token;
        app.api.checkUser()
        .then(valid => {
          if (valid) {
            app.saveConfig();
            app.api.setWebhooks();
            app.api.checkStream();
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
    this.express.get('/wh/:cb', (req, res) => {
      if (req.query['hub.challenge'] && req.query['hub.mode']) {
        console.log(`${req.params.cb} webhook subscription ${req.query['hub.mode']}ed successfully`);
        if (req.query['hub.mode'] === 'subscribe') {
          if (req.query['hub.lease_seconds']) {
            app.api.whTimeouts[req.params.cb] = setTimeout(http.whCreateFuncs[req.params.cb], req.query['hub.lease_seconds'] * 1000);
          }
        } else {
          clearTimeout(app.api.whTimeouts[req.params.cb]);
        }

        res.send(req.query['hub.challenge']);
      }
    });

    // The webhook callback
    this.express.post('/wh/:cb', (req, res) => {
      if (!req.verified) {
        res.sendStatus(403).end();
        return;
      }

      if (!req.headers['twitch-notification-id'] || http.whProcessed.has(req.headers['twitch-notification-id'])) {
        req.end();
        return;
      }

      switch (req.params.cb) {
        case 'stream':
          app.islive = req.body.data && req.body.data.length > 0;
          console.log(`channel is ${app.islive ? 'LIVE!' : 'offline'}`);

          break;
        case 'follows':
          if (req.body.data) {
            for (let i = req.body.data.length - 1; i >= 0; i--) {
              http.sendAlert('follower', {
                user: req.body.data[i].from_name
              });
            };
          }

          break;
      }

      http.whProcessed.add(req.headers['twitch-notification-id']);

      res.end();
    });

    // The overlay page
    this.express.get('/overlay', (req, res) => {
      const options = {
        layout: false,
        config: { }
      };

      if (req.query.alerts) {
        options.alerts = app.alerts;
        options.config.alerts = true;
        options.config.donordrive = {
          instance: app.settings.donordrive_instance,
          participant: app.settings.donordrive_participant,
          alertduration: app.alerts.charitydonation.duration * 1000
        };
      }

      if (req.query.countdown) {
        options.countdown = true;
        options.countdown_audio = app.settings.countdown_audio;
        options.config.schedule = app.schedule;
      }

      if (req.query.nextstream) {
        options.nextstream = true;
        options.config.schedule = app.schedule;
      }

      if (req.query.sfx) {
        options.sfx = app.sfx;
        options.config.sfx = true;
      }

      new Promise((resolve, reject) => {
        if (req.query.tips) {
          options.config.tips = [];
          options.tips = true;
          app.db.all('SELECT message FROM tips ORDER BY RANDOM() LIMIT 50', (err, rows) => {
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
    this.express.post('/test', (req, res) => {
      if (!app.config.debug) {
        res.sendStatus(403).end();
        return;
      }

      if (req.body.alert) {
        http.sendAlert(req.body.type, req.body);
      }

      res.redirect('/');
    });
  }

  /**
   * Send a new alert to the overlay page.
   *
   * @param {string} type The type of alert to send
   * @param {object} params The alert parameters
   */
  sendAlert(type, params) {
    const alert = this.app.alerts[type];

    if ((!alert.message && !alert.graphic && !alert.sound) || !alert.duration) {
      return;
    }

    const duration = Math.max(1, alert.duration) * 1000;

    this.io.emit('alert', type, params, duration);
    console.log(`alert sent: ${type}`);
  }

  /**
   * Send a new sound effect to the overlay page.
   *
   * @param {string} name The name of the sound effect to send
   */
  sendSfx(name) {
    this.io.emit('sfx', name);
  }

  /**
   * Verify a signed request.
   *
   * @param {express.Request} req The request object
   * @param {express.response} res The response object
   * @param {Buffer} buf Buffer containing the raw request body
   * @param {string} encoding The encoding of the request
   */
  verifyRequest(req, res, buf, encoding) {
    req.verified = false;
    if (req.headers['x-hub-signature']) {
      const hash = crypto.createHmac('sha256', settings.secret).update(buf).digest('hex');
      req.verified = req.headers['x-hub-signature'] === `sha256=${hash}`;
    }
  }
}

module.exports.HttpServer = HttpServer;
