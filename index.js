/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict';

import { EventEmitter } from 'events';
import fs from 'fs';

// Modules
import Backend from './modules/backend.js';
import ChatBot from './modules/chatbot.js';
import Charity from './modules/charity.js';
import Commands from './modules/commands.js';
import Database from './modules/database.js';
import DiscordBot from './modules/discord.js';
import HttpServer from './modules/httpserver.js';
import Redemptions from './modules/redemptions.js';
import Stats from './modules/stats.js';
import TwitchApi from './modules/twitchapi.js';
import TwitterBot from './modules/twitter.js';

/**
 * The main application class.
 */
class App {

  /**
   * Constructor.
   */
  constructor() {
    this.config = JSON.parse(fs.readFileSync('./config.json'));

    // Construct the base URL for the application
    this.config.url = `${this.config.ssl.enabled ? 'https' : 'http'}://${this.config.host}:${this.config.port}`;

    // Create the data directory
    try {
      fs.mkdirSync('./data');
    } catch {
      // Do nothing; directory probably exists
    }

    this.emitter = new EventEmitter();

    // Application settings
    this.settings = {};

    // Module instances
    this.api = new TwitchApi(this);
    new Backend(this);
    this.commands = new Commands(this);
    this.charity = new Charity(this);
    this.chatbot = new ChatBot(this);
    this.database = new Database(this);
    this.discord = new DiscordBot(this);
    this.http = new HttpServer(this);
    this.redemptions = new Redemptions(this);
    this.stats = new Stats(this);
    this.twitter = new TwitterBot(this);
  }

  /**
   * Save the settings to the database.
   */
  async saveSettings() {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

    for (const key in this.settings) {
      stmt.run(key, this.settings[key]);
    }

    stmt.finalize();
  }

  /**
   * Get the SQLite3 database object.
   */
  get db() {
    return this.database.db;
  }
}

// Run the application
new App();
