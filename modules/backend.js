/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict';

import AlertsBackend from './backend/alerts.js';
import AutogreetBackend from './backend/autogreet.js';
import GiveawayBackend from './backend/giveaway.js';
import QuotesBackend from './backend/quotes.js';
import RaffleBackend from './backend/raffle.js';
import RedemptionsBackend from './backend/redemptions.js';
import ScheduleBackend from './backend/schedule.js';
import SettingsBackend from './backend/settings.js';
import SfxBackend from './backend/sfx.js';
import TestBackend from './backend/test.js';
import TimersBackend from './backend/timers.js';
import TipsBackend from './backend/tips.js';
import TriggersBackend from './backend/triggers.js';
import TriviaBackend from './backend/trivia.js';

/**
 * Provides the backend interface.
 */
export default class Backend {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    this.app = app;

    this.handlers = {};

    app.emitter.on('dbready', () => {
      this.loadHandler('alerts', new AlertsBackend());
      this.loadHandler('autogreet', new AutogreetBackend());
      this.loadHandler('giveaway', new GiveawayBackend());
      this.loadHandler('quotes', new QuotesBackend());
      this.loadHandler('raffle', new RaffleBackend());
      this.loadHandler('redemptions', new RedemptionsBackend());
      this.loadHandler('schedule', new ScheduleBackend());
      this.loadHandler('settings', new SettingsBackend());
      this.loadHandler('sfx', new SfxBackend());
      this.loadHandler('test', new TestBackend());
      this.loadHandler('timers', new TimersBackend());
      this.loadHandler('tips', new TipsBackend());
      this.loadHandler('triggers', new TriggersBackend());
      this.loadHandler('trivia', new TriviaBackend());

      this.setupRoutes(app);
    });
  }

  /**
   * Set up the backend HTTP routes.
   *
   * @param {Aoo} app The main application
   */
  setupRoutes(app) {
    app.http.express.get('/admin', (req, res) => {
      if (req.cookies.token === undefined || req.cookies.token !== app.settings.web_token) {
        res.redirect('/login');
        return;
      }

      res.render('admin', { layout: 'admin' });
    });

    app.http.express.get('/admin/:page', (req, res) => {
      if (req.cookies.token === undefined || req.cookies.token !== app.settings.web_token) {
        res.redirect('/login');
        return;
      }

      if (!this.handlers[req.params.page]) {
        res.sendStatus(404);
        return;
      }

      new Promise((resolve) => {
        this.handlers[req.params.page].get(resolve, req, res);
      })
      .then((data) => {
        const options = {
          layout: 'admin',
          data: data
        };

        res.render(req.params.page, options);
      });
    });

    app.http.express.post('/admin/:page', (req, res) => {
      if (req.cookies.token === undefined || req.cookies.token !== app.settings.web_token) {
        res.redirect('/login');
        return;
      }

      if (!this.handlers[req.params.page]) {
        res.sendStatus(404);
        return;
      }

      new Promise((resolve) => {
        this.handlers[req.params.page].post(resolve, req, res);
      })
      .then((redir = true) => {
        if (redir) {
          res.redirect('back');
        } else {
          res.end();
        }
      });
    });
  }

  /**
   * Add a handler for a backend page.
   *
   * @param {string} name The name of the page
   * @param {Object} handler The object to handle the page
   */
  loadHandler(name, handler) {
    handler.app = this.app;
    handler.db = this.app.db;
    this.handlers[name] = handler;
  }
}
