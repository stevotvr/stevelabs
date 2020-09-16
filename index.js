/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

import fs from 'fs';

// Modules
import Backend from './modules/backend.js';
import ChatBot from './modules/chatbot.js';
import Commands from './modules/commands.js';
import Database from './modules/database.js';
import DiscordBot from './modules/discord.js';
import HttpServer from './modules/httpserver.js';
import Redemptions from './modules/redemptions.js';
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

    // Application data
    this.settings = {};
    this.alerts = {};
    this.commands = {};
    this.timers = [];
    this.schedule = [];
    this.sfx = {};

    // Module instances
    this.db = new Database(this);
    this.api = new TwitchApi(this);
    this.cmds = new Commands(this);
    this.chatbot = new ChatBot(this);
    this.discord = new DiscordBot(this);
    this.twitter = new TwitterBot(this);
    this.http = new HttpServer(this);
    this.redemptions = new Redemptions(this);
    new Backend(this);
  }

  /**
   * Save the settings to the database.
   */
  async saveSettings() {
    const stmt = this.db.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

    for (const key in this.settings) {
      stmt.run(key, this.settings[key]);
    }

    stmt.finalize();
  }
}

// Run the application
new App();
