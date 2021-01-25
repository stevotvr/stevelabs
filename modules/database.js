/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict';

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

            if (app.settings.tts_volume === undefined) {
              app.settings.tts_volume = 100;
              app.saveSettings();
            }

            app.settings.raffle_active = app.settings.raffle_active === '1';

            db.run('CREATE TABLE IF NOT EXISTS alerts (key TEXT PRIMARY KEY, message TEXT, graphic TEXT, sound TEXT, duration INTEGER NOT NULL DEFAULT 5, videoVolume INTEGER NOT NULL DEFAULT 100, soundVolume INTEGER NOT NULL DEFAULT 100)')
              .prepare('INSERT OR IGNORE INTO alerts (key, message) VALUES (?, ?)')
              .run('charitydonation', '${user} donated ${amount} to charity!')
              .run('cheer', '${user} cheered ${amount} bits!')
              .run('follower', '${user} is now following!')
              .run('greet', 'Welcome, ${user}!')
              .run('host', '${user} hosted the channel with ${viewers} viewers!')
              .run('rafflewinner', '${user} won the raffle!')
              .run('raid', '${user} raided the channel with ${viewers} viewers!')
              .run('resub', '${user} has resubscribed for ${months} months!')
              .run('shoutout', 'twitch.tv/${user}')
              .run('subgift', '${user} gifted a subscription to ${recipient}!')
              .run('submysterygift', '${user} gifted subscriptions to ${subcount} lucky viewers!')
              .run('subscription', '${user} has subscribed!')
              .finalize();

            db.run('CREATE TABLE IF NOT EXISTS autogreet (user TEXT PRIMARY KEY)');
            db.run('CREATE TABLE IF NOT EXISTS giveaway (id INTEGER PRIMARY KEY AUTOINCREMENT, groupId INTEGER NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL, recipient TEXT)');
            db.run('CREATE TABLE IF NOT EXISTS giveaway_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, random INTEGER NOT NULL DEFAULT 0, raffle INTEGER NOT NULL DEFAULT 0)');
            db.run('CREATE TABLE IF NOT EXISTS quotes (id INTEGER PRIMARY KEY AUTOINCREMENT, date INTEGER NOT NULL, user TEXT NOT NULL, game TEXT NOT NULL, message TEXT NOT NULL)');
            db.run('CREATE TABLE IF NOT EXISTS raffle (user TEXT PRIMARY KEY, tickets INTEGER NOT NULL DEFAULT 1)');
            db.run('CREATE TABLE IF NOT EXISTS redemptions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, command TEXT NOT NULL)');
            db.run('CREATE TABLE IF NOT EXISTS schedule (id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER NOT NULL DEFAULT 0, hour INTEGER NOT NULL DEFAULT 0, minute INTEGER NOT NULL DEFAULT 0, length INTEGER NOT NULL DEFAULT 0, game TEXT NOT NULL DEFAULT \'\')');
            db.run('CREATE TABLE IF NOT EXISTS sfx (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, file TEXT NOT NULL, volume INTEGER NOT NULL DEFAULT 100)');
            db.run('CREATE TABLE IF NOT EXISTS timers (id INTEGER PRIMARY KEY AUTOINCREMENT, pos INTEGER NOT NULL DEFAULT 0, command TEXT NOT NULL)');
            db.run('CREATE TABLE IF NOT EXISTS tips (id INTEGER PRIMARY KEY AUTOINCREMENT, date INTEGER NOT NULL, user TEXT NOT NULL DEFAULT \'\', message TEXT NOT NULL)');
            db.run('CREATE TABLE IF NOT EXISTS triggers (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, level INTEGER NOT NULL DEFAULT 0, user_timeout INTEGER NOT NULL DEFAULT 0, global_timeout INTEGER NOT NULL DEFAULT 0, aliases TEXT NOT NULL DEFAULT \'\', command TEXT NOT NULL)');
            db.run('CREATE TABLE IF NOT EXISTS trivia (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, answer TEXT NOT NULL, details TEXT NOT NULL)');
            db.run('CREATE TABLE IF NOT EXISTS userstats (user TEXT PRIMARY KEY, chats INTEGER NOT NULL DEFAULT 0, trivia INTEGER NOT NULL DEFAULT 0, ignore INTEGER NOT NULL DEFAULT 0)');

            db.close((err) => {
              if (err) {
                console.warn('error closing database');
                console.log(err);

                return;
              }

              this.db = new sqlite3.Database('./data/stevelabs.db', (err) => {
                if (err) {
                  console.warn('database connection failed');
                  console.log(err);

                  return;
                }

                app.emitter.emit('dbready');
              });
            });
          });
        });
      });
  }
}
