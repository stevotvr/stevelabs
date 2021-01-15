/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

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
    this.db = commands.app.db.db

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
      this.answer = row.answer.trim().toLowerCase();
      this.details = row.details;

      if (row) {
        this.app.chatbot.say(`/me Trivia time! Answer this question correctly in chat for some chat points: ${row.question}`);
        this.app.http.sendTrivia(row.question);
      } else if (user) {
        this.app.chatbot.say(`Sorry, ${user}, we're all out of trivia!`);
      }
    };

    if (args[0] && args[0].match(/\d+/)) {
      this.db.get('SELECT id, question, answer, details FROM trivia WHERE user IS NULL AND id = ?', args[0], cb);
    } else {
      this.db.get('SELECT id, question, answer, details FROM trivia WHERE user IS NULL ORDER BY RANDOM() LIMIT 1', cb);
    }
  }

  async answerTrivia(user, args = []) {
    if (!this.id || args.length < 1) {
      return;
    }

    const answer = args[0].trim().substr(0, this.answer.length).toLowerCase();
    if (answer === this.answer) {
      if (user) {
        this.app.stats.addUserTrivia(user);
        this.db.run('UPDATE trivia SET user = ? WHERE id = ?', [ user, this.id ]);
        this.app.chatbot.say(`/me That's correct, ${user}! ${this.details}`);
        this.app.http.sendTrivia(`${user} answered correctly! ${this.details}`);
      }

      this.id = null;
    }
  }
}
