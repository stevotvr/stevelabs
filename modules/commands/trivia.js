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
 * Provides the trivia command.
 */
export default class TriviaCommand {

  /**
   * Constructor.
   *
   * @param {Commands} commands The main command module
   */
  constructor(commands) {
    this.app = commands.app;

    commands.trivia = this.trivia;
    commands.answerTrivia = this.answerTrivia;
  }

  async trivia(user, args = []) {
    const cb = (err, row) => {
      if (err) {
        console.warn('error getting trivia data');
        console.log(err);

        return;
      }

      this.id = row.id;
      this.answer = new Set(row.answer.trim().toLowerCase().split('|'));
      this.details = row.details;

      if (row) {
        this.app.chatbot.say(`/me Trivia time! Answer this question correctly in chat for some chat points: ${row.question}`);
        this.app.http.sendTrivia(`Answer in chat: ${row.question}`);
      } else if (user) {
        this.app.chatbot.say(`Sorry, ${user.displayName}, we're all out of trivia!`);
      }
    };

    if (args[0] && args[0].match(/\d+/)) {
      this.app.db.get('SELECT id, question, answer, details FROM trivia AND id = ?', args[0], cb);
    } else {
      this.app.db.get('SELECT id, question, answer, details FROM trivia ORDER BY RANDOM() LIMIT 1', cb);
    }
  }

  async answerTrivia(user, args = []) {
    if (!this.id || args.length < 1) {
      return;
    }

    const answer = args[0].trim().toLowerCase();
    if (this.answer.has(answer)) {
      if (user) {
        this.app.stats.addUserTrivia(user.userId);
        this.app.chatbot.say(`/me That's correct, ${user.displayName}! ${this.details}`);
        this.app.http.sendTrivia(`${user.displayName} answered correctly! ${this.details}`);
      }

      this.id = null;
    }
  }
}
