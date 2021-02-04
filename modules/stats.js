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
   * @param {string} userId The Twitch user ID
   */
  addUserChat(userId) {
    this.app.db.run('UPDATE users SET chats = chats+1 WHERE userId = ?', [ userId ]);
  }

  /**
   * Add a trivia correct answer action to a user.
   *
   * @param {string} userId The Twitch user ID
   */
  addUserTrivia(userId) {
    this.app.db.run('UPDATE users SET trivia = trivia+1 WHERE userId = ?', [ userId ]);
  }
}
