/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

import { ApiClient } from 'twitch';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import express from 'express';
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
    this.alerts = {};
    this.schedule = [];
    this.sfx = {};

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
   * Load the alerts from the database.
   */
  loadAlerts() {
    this.app.db.db.all('SELECT key, message, graphic, sound, duration, videoVolume, soundVolume FROM alerts', (err, rows) => {
      if (err) {
        console.warn('error loading alerts from the database');
        console.log(err);

        return;
      }

      const alerts = {};
      rows.forEach((row) => {
        alerts[row.key] = {
          message: row.message,
          graphic: row.graphic,
          sound: row.sound,
          duration: row.duration,
          videoVolume: row.videoVolume,
          soundVolume: row.soundVolume
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

      this.alerts = alerts;
    });
  }

  /**
   * Load the schedule from the database.
   */
  loadSchedule() {
    this.app.db.db.all('SELECT day, hour, minute, length, game FROM schedule ORDER BY day, hour, minute, length', (err, rows) => {
      if (err) {
        console.warn('error loading schedule from the database');
        console.log(err);

        return;
      }

      const schedule = [];
      rows.forEach((row) => schedule.push(row));

      this.schedule = schedule;
    });
  }

  /**
   * Load the sound effects from the database.
   */
  loadSfx() {
    this.app.db.db.all('SELECT key, file, volume FROM sfx', (err, rows) => {
      if (err) {
        console.warn('error loading sfx from the database');
        console.log(err);

        return;
      }

      const sfx = {};
      rows.forEach((row) => {
        sfx[row.key] = {
          file: row.file,
          volume: row.volume
        };
      });

      this.sfx = sfx;
    });
  }

  /**
   * Set up HTTP server routes.
   */
  setupHttpRoutes() {
    // Index page; shows the Twitch auth link
    this.express.get('/', (req, res) => {
      res.render('index');
    });

    // The login page
    this.express.get('/login', (req, res) => {
      if (req.query.code) {
        ApiClient.getAccessToken(this.app.config.oauth.client, this.app.config.oauth.secret, req.query.code, `${this.app.config.url}/login`)
          .then((token) => {
            this.app.api.login(token.accessToken, token.refreshToken)
            .then((valid) => {
              if (valid) {
                this.app.settings.web_token = crypto.randomBytes(64).toString('hex');
                this.app.saveSettings();

                res.cookie('token', this.app.settings.web_token, {
                  maxAge: 7776000000,
                  secure: this.app.config.ssl.enabled,
                  httpOnly: true
                });

                res.redirect('/');
              } else {
                res.redirect('/login');
              }
            });
          });
      } else {
        const scopes = [
          'user:read:email',
          'chat:read',
          'chat:edit',
          'whispers:read',
          'whispers:edit',
          'channel:read:redemptions'
        ];
        res.render('login', { connectUrl: `https://id.twitch.tv/oauth2/authorize?client_id=${this.app.config.oauth.client}&redirect_uri=${this.app.config.url}/login&response_type=code&scope=${scopes.join('+')}` })
      }
    });

    // The overlay page
    this.express.get('/overlay', (req, res) => {
      const options = {
        layout: false,
        config: { }
      };

      if (req.query.alerts) {
        options.alerts = this.alerts;
        options.config.alerts = true;
        options.config.donordrive = {
          instance: this.app.settings.donordrive_instance,
          participant: this.app.settings.donordrive_participant,
          duration: this.alerts.charitydonation.duration * 1000,
          video_volume: this.alerts.charitydonation.videoVolume,
          sound_volume: this.alerts.charitydonation.soundVolume
        };
      }

      if (req.query.countdown) {
        options.countdown = true;
        options.countdown_audio = this.app.settings.countdown_audio;
        options.config.schedule = this.schedule;
        options.config.countdown_audio_volume = this.app.settings.countdown_audio_volume;
      }

      if (req.query.nextstream) {
        options.nextstream = true;
        options.config.schedule = this.schedule;
      }

      if (req.query.sfx) {
        options.sfx = this.sfx;
        options.config.sfx = true;
      }

      if (req.query.tts) {
        options.config.tts = {
          key: this.app.settings.tts_api_key,
          voice: this.app.settings.tts_voice,
          volume: this.app.settings.tts_volume
        };
      }

      new Promise((resolve, reject) => {
        if (req.query.tips) {
          options.config.tips = [];
          options.tips = true;
          this.app.db.db.all('SELECT message FROM tips ORDER BY RANDOM() LIMIT 50', (err, rows) => {
            if (err) {
              console.warn('error loading tip data');
              console.log(err);

              return;
            }

            rows.forEach((row) => {
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
    const alert = this.alerts[type];

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
    if (!this.sfx[name]) {
      return false;
    }

    this.io.emit('sfx', name, this.sfx[name].volume);

    return true;
  }

  /**
   * Send a new text-to-speech message to the overlay page.
   *
   * @param {string} message The message to send
   */
  sendTts(message) {
    this.io.emit('tts', message);
  }
}
