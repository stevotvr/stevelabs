/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

import cookieParser from 'cookie-parser';
import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs';
import handlebars from 'express-handlebars';
import http from 'http';
import https from 'https';
import Socket from 'socket.io';

/**
 * Provides HTTP server functionality.
 */
export default class HttpServer {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    this.app = app;

    const hbs = handlebars.create({
      helpers: {
        eq: function(p1, p2, options) {
          return p1 === p2 ? options.fn(this) : options.inverse(this);
        }
      }
    });

    // Set up the Express application
    this.express = express();
    this.express.engine('handlebars', hbs.engine);
    this.express.set('view engine', 'handlebars');
    this.express.use(express.urlencoded({ extended: true }));
    this.express.use(express.static('public'));
    this.express.use(cookieParser());

    // Create the HTTP server
    const httpServer = (() => {
      if (app.config.ssl.enabled) {
        const options = {
          key: fs.readFileSync(app.config.ssl.keyfile),
          cert: fs.readFileSync(app.config.ssl.cert),
          ca: fs.readFileSync(app.config.ssl.cafile)
        };

        return https.createServer(options, this.express);
      } else {
        return http.Server(this.express);
      }
    })();

    // Create the socket
    this.io = Socket(httpServer);

    // Start listening to HTTP requests
    httpServer.listen(app.config.port, app.config.host, () => {
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
      res.render('index');
    });

    // The login page
    this.express.get('/login', (req, res) => {
      if (req.query.code) {
        const url = `https://id.twitch.tv/oauth2/token?client_id=${app.config.oauth.client}&client_secret=${app.config.oauth.secret}&code=${req.query.code}&grant_type=authorization_code&redirect_uri=${app.config.url}/login`;

        fetch(url, {
          method: 'POST'
        })
        .then(res => res.json())
        .then(auth => {
          app.api.login(auth.access_token, auth.refresh_token)
          .then(valid => {
            if (valid) {
              app.settings.web_token = crypto.randomBytes(64).toString('hex');
              app.saveSettings();

              res.cookie('token', app.settings.web_token, {
                maxAge: 7776000000,
                secure: app.config.ssl.enabled,
                httpOnly: true
              });

              res.redirect('/');
            } else {
              res.redirect('/login');
            }
          });
        });
      } else {
        res.render('login', { connectUrl: `https://id.twitch.tv/oauth2/authorize?client_id=${app.config.oauth.client}&redirect_uri=${app.config.url}/login&response_type=code&scope=user:read:email+chat:read+chat:edit` })
      }
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
          duration: app.alerts.charitydonation.duration * 1000,
          video_volume: app.alerts.charitydonation.videoVolume,
          sound_volume: app.alerts.charitydonation.soundVolume
        };
      }

      if (req.query.countdown) {
        options.countdown = true;
        options.countdown_audio = app.settings.countdown_audio;
        options.config.schedule = app.schedule;
        options.config.countdown_audio_volume = app.settings.countdown_audio_volume;
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
          app.db.db.all('SELECT message FROM tips ORDER BY RANDOM() LIMIT 50', (err, rows) => {
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

    this.io.emit('alert', type, params, duration, alert.videoVolume, alert.soundVolume);
    console.log(`alert sent: ${type}`);
  }

  /**
   * Send a new sound effect to the overlay page.
   *
   * @param {string} name The name of the sound effect to send
   */
  sendSfx(name) {
    if (!this.app.sfx[name]) {
      return;
    }

    this.io.emit('sfx', name, this.app.sfx[name].volume);
  }
}
