/**
 * This file is part of StoveLabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

const fs = require('fs');

// User configurations
const config = require('./config.json');

// Modules
const Backend = require('./modules/backend');
const ChatBot = require('./modules/chatbot');
const Database = require('./modules/database');
const DiscordBot = require('./modules/discord');
const HttpServer = require('./modules/httpserver');
const TwitchApi = require('./modules/twitchapi');

/**
 * The main application class.
 */
class App {

  /**
   * Constructor.
   */
  constructor() {
    this.config = config;

    // Construct the base URL for the application
    config.url = `${config.ssl.enabled ? 'https' : 'http'}://${config.host}:${config.port}`;

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
    this.db = new Database.Database(this);
    this.api = new TwitchApi.TwitchApi(this);
    this.chatbot = new ChatBot.ChatBot(this);
    this.discord = new DiscordBot.DiscordBot(this);
    this.http = new HttpServer.HttpServer(this);
    new Backend.Backend(this);
  }

  /**
   * Save the settings to the database.
   */
  saveSettings() {
    const stmt = this.db.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

    for (const key in this.settings) {
      stmt.run(key, this.settings[key]);
    }

    stmt.finalize();
  }
}

// Run the application
new App();
