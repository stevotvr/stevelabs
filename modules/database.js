/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

import sqlite3 from 'sqlite3';

/**
 * Handles database operations.
 */
export default class Database {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    this.app = app;

    // Create the database connection
    const db = new sqlite3.Database('./data/stevelabs.db', (err) => {
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

            rows.forEach((row) => {
              app.settings[row.key] = row.value;
            });

            if (app.settings.countdown_audio_volume === undefined) {
              app.settings.countdown_audio_volume = 100;
              app.saveSettings();
            }

            app.settings.raffle_active = app.settings.raffle_active === '1';

            app.api.login(app.settings.oauth_access_token, app.settings.oauth_refresh_token);
            app.api.login(app.settings.bot_access_token, app.settings.bot_refresh_token);

            if (app.settings.discord_bot_token) {
              app.discord.login(app.settings.discord_bot_token);
            }

            app.twitter.login();

            app.http.setupHttpRoutes();

            db.serialize(() => {
              db.run('CREATE TABLE IF NOT EXISTS alerts (key TEXT PRIMARY KEY, message TEXT, graphic TEXT, sound TEXT, duration INTEGER NOT NULL DEFAULT 5, videoVolume INTEGER NOT NULL DEFAULT 100, soundVolume INTEGER NOT NULL DEFAULT 100)')
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
                .run('rafflewinner', '${user} won the raffle!')
                .run('shoutout', 'Welcome, ${user}!')
                .finalize();
                this.loadAlerts();
            });

            db.serialize(() => {
              db.run('CREATE TABLE IF NOT EXISTS triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, level INTEGER NOT NULL DEFAULT 0, user_timeout INTEGER NOT NULL DEFAULT 0, global_timeout INTEGER NOT NULL DEFAULT 0, aliases TEXT NOT NULL DEFAULT \'\', command TEXT NOT NULL)');
              this.loadTriggers();
            });

            db.serialize(() => {
              db.run('CREATE TABLE IF NOT EXISTS timers (id INTEGER PRIMARY KEY AUTOINCREMENT, pos INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL)');
              this.loadTimers();
            });

            db.serialize(() => {
              db.run('CREATE TABLE IF NOT EXISTS schedule (id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER NOT NULL DEFAULT 0, hour INTEGER NOT NULL DEFAULT 0, minute INTEGER NOT NULL DEFAULT 0, length INTEGER NOT NULL DEFAULT 0, game TEXT NOT NULL DEFAULT \'\')');
              this.loadSchedule();
            });

            db.serialize(() => {
              db.run('CREATE TABLE IF NOT EXISTS sfx (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, file TEXT NOT NULL, volume INTEGER NOT NULL DEFAULT 100)');
              this.loadSfx();
            });

            db.run('CREATE TABLE IF NOT EXISTS tips (id INTEGER PRIMARY KEY AUTOINCREMENT, date INTEGER NOT NULL, user TEXT NOT NULL DEFAULT \'\', message TEXT NOT NULL)');
            db.run('CREATE TABLE IF NOT EXISTS raffle (user TEXT PRIMARY KEY, tickets INTEGER NOT NULL DEFAULT 1)');
            db.run('CREATE TABLE IF NOT EXISTS autoshoutout (user TEXT PRIMARY KEY)');
            db.run('CREATE TABLE IF NOT EXISTS quotes (id INTEGER PRIMARY KEY AUTOINCREMENT, date INTEGER NOT NULL, user TEXT NOT NULL, game TEXT NOT NULL, message TEXT NOT NULL)');
            db.run('CREATE TABLE IF NOT EXISTS giveaway (id INTEGER PRIMARY KEY AUTOINCREMENT, groupId INTEGER NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL, recipient TEXT)');
            db.run('CREATE TABLE IF NOT EXISTS giveaway_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, random INTEGER NOT NULL DEFAULT 0, raffle INTEGER NOT NULL DEFAULT 0, redemption TEXT)');
          });
        });
      });

    this.db = db;
  }

  /**
   * Load the alerts from the database.
   */
  loadAlerts() {
    this.db.all('SELECT key, message, graphic, sound, duration, videoVolume, soundVolume FROM alerts', (err, rows) => {
      if (err) {
        console.warn('error loading alerts from the database');
        console.log(err);

        return;
      }

      this.app.alerts = {};
      rows.forEach((row) => {
        this.app.alerts[row.key] = {
          message: row.message,
          graphic: row.graphic,
          sound: row.sound,
          duration: row.duration,
          videoVolume: row.videoVolume,
          soundVolume: row.soundVolume
        };
      });

      for (const key in this.app.alerts) {
        const alert = this.app.alerts[key];
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
  }

  /**
   * Load the chat triggers from the database.
   */
  loadTriggers() {
    this.db.all('SELECT key, level, user_timeout, global_timeout, aliases, command FROM triggers', (err, rows) => {
      if (err) {
        console.warn('error loading triggers from the database');
        console.log(err);

        return;
      }

      this.app.triggers = {};
      const keys = [];
      rows.forEach((row) => {
        this.app.triggers[row.key] = {
          trigger: row.key,
          level: row.level,
          user_timeout: row.user_timeout,
          global_timeout: row.global_timeout,
          aliases: row.aliases ? row.aliases.split(',') : [],
          command: row.command
        };

        keys.push(row.key);
      });

      for (const k in this.app.triggers) {
        for (const k2 in this.app.triggers[k].aliases) {
          this.app.triggers[this.app.triggers[k].aliases[k2]] = this.app.triggers[k];
          keys.push(this.app.triggers[k].aliases[k2]);
        }

        this.app.triggers[k].timeouts = {
          global: 0,
          user: {}
        };
      }

      keys.sort((a, b) => b.length - a.length);
      this.app.triggers._keys = keys;
    });
  }

  /**
   * Load the timers from the database.
   */
  loadTimers() {
    this.db.all('SELECT message FROM timers ORDER BY pos', (err, rows) => {
      if (err) {
        console.warn('error loading timers from the database');
        console.log(err);

        return;
      }

      this.app.timers = [];
      rows.forEach((row) => this.app.timers.push(row.message));
    });
  }

  /**
   * Load the schedule from the database.
   */
  loadSchedule() {
    this.db.all('SELECT day, hour, minute, length, game FROM schedule ORDER BY day, hour, minute, length', (err, rows) => {
      if (err) {
        console.warn('error loading schedule from the database');
        console.log(err);

        return;
      }

      this.app.schedule = [];
      rows.forEach((row) => this.app.schedule.push(row));
    });
  }

  /**
   * Load the sound effects from the database.
   */
  loadSfx() {
    this.db.all('SELECT key, file, volume FROM sfx', (err, rows) => {
      if (err) {
        console.warn('error loading sfx from the database');
        console.log(err);

        return;
      }

      this.app.sfx = {};
      rows.forEach((row) => {
        this.app.sfx[row.key] = {
          file: row.file,
          volume: row.volume
        };
      });
    });
  }
}
