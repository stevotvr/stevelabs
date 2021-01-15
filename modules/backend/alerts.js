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
 * Handler for the alerts backend.
 */
export default class AlertsBackend {
  get(resolve) {
    this.db.all('SELECT key, message, graphic, sound, duration, videoVolume, soundVolume FROM alerts ORDER BY key ASC', (err, rows) => {
      resolve({ alerts: rows });
    });
  }

  post(resolve, req) {
    if (typeof req.body.update === "object") {
      let count = Object.keys(req.body.update).length;
      if (!count) {
        resolve();
      }

      const stmt = this.db.prepare('UPDATE alerts SET message = ?, graphic = ?, sound = ?, duration = ?, videoVolume = ?, soundVolume = ? WHERE key = ?');

      for (const key in req.body.update) {
        const row = req.body.update[key];
        const videoVolume = row.videoVolume ? Math.min(100, Math.max(0, row.videoVolume)) : 100;
        const soundVolume = row.soundVolume ? Math.min(100, Math.max(0, row.soundVolume)) : 100;
        stmt.run(row.message, row.graphic, row.sound, Math.max(1, row.duration), videoVolume, soundVolume, key, () => {
          if (!--count) {
            this.app.http.loadAlerts();
            resolve();
          }
        });
      }

      stmt.finalize();
    }
  }
}
