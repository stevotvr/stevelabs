/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict';

/**
 * Handles statistics.
 */
export default class Stats {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    this.app = app;
  }

  /**
   * Add a chat action to a user.
   *
   * @param {string} user The username
   */
  addUserChat(user) {
    this.app.db.db.run('INSERT INTO userstats (user, chats) VALUES (?, 1) ON CONFLICT (user) DO UPDATE SET chats = chats+1 WHERE user = ?', [ user, user ]);
  }

  /**
   * Add a trivia correct answer action to a user.
   *
   * @param {string} user The username
   */
  addUserTrivia(user) {
    this.app.db.db.run('INSERT INTO userstats (user, trivia) VALUES (?, 1) ON CONFLICT (user) DO UPDATE SET trivia = trivia+1 WHERE user = ?', [ user, user ]);
  }
}
