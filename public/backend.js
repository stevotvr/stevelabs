/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict';

const testButtons = document.getElementsByClassName('testbutton');
for (let i = 0; i < testButtons.length; i++) {
  const name = testButtons[i].name;
  const type = name[0] === 'a' ? 'alert' : 'sfx';
  const key = name.substring(6, name.length - 1);
  testButtons[i].onclick = () => sendTest(type, key);
}

function sendTest(type, key) {
  const xlr = new XMLHttpRequest();
  xlr.open('POST', '/admin/test');
  xlr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  xlr.send(`${type}=${key}`);
}
