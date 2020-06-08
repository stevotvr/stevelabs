/**
 * This file is part of StoveLabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

/**
 * Socket
 */

if (config.alerts || config.sfx) {
  // Create the socket connection
  const socket = io('//' + window.location.host);

  // Socket connected event
  socket.on('connect', () => {
    console.log('connected to socket');
  });

  // Socket disconnected event
  socket.on('disconnect', () => {
    console.log('socket connection lost');
  });

  // New alert event
  socket.on('alert', (type, params, duration) => {
    addAlert(type, params, duration);
  });

  // New sfx event
  socket.on('sfx', (key) => {
    addSound(key);
  });
}

/**
 * Alerts
 */

// Queue of events ready to be displayed
const alertQueue = [];

/**
 * Add a new alert to the queue.
 *
 * @param {string} type The type of event
 * @param {object} params The event parameters
 * @param {int} duration The event duration in milliseconds
 */
function addAlert(type, params, duration) {
  alertQueue.push({
    type: type,
    params: params,
    duration: duration
  });

  if (alertQueue.length === 1) {
    showNextAlert();
  }

  console.log(type, params, duration);
}

/**
 * Show the next alert in the queue.
 */
function showNextAlert() {
  if (!alertQueue.length) {
    return;
  }

  const { type, params, duration } = alertQueue[0];

  const alertElem = document.getElementById(type);
  if (!alertElem) {
    return;
  }

  const messageElems = alertElem.getElementsByTagName('p');
  if (messageElems && messageElems.length) {
    for (const key in params) {
      const elems = messageElems[0].getElementsByClassName(key);
      if (elems) {
        for (let i = 0; i < elems.length; i++) {
          elems[i].innerText = params[key];
        }
      }
    }
  }

  alertElem.style.opacity = 1;
  setTimeout(() => {
    alertElem.style.opacity = 0;
    setTimeout(() => {
      alertQueue.shift();
      showNextAlert();
    }, 1000);
  }, duration);

  const videoElems = alertElem.getElementsByTagName('video');
  if (videoElems && videoElems.length) {
    videoElems[0].currentTime = 0;
    videoElems[0].play();
  }

  const audioElems = alertElem.getElementsByTagName('audio');
  if (audioElems && audioElems.length) {
    audioElems[0].currentTime = 0;
    audioElems[0].play();
  }
}

/**
 * DonorDrive
 */

// The ID of the latest donation
let latestDonation = null;

// Start querying the DonorDrive API
if (config.donordrive && config.donordrive.instance && config.donordrive.participant) {
  queryDonorDrive();
  setInterval(queryDonorDrive, 15000);
}

/**
 * Query the DonorDrive API
 */
function queryDonorDrive() {
  fetch(`https://${config.donordrive.instance}.donordrive.com/api/participants/${config.donordrive.participant}/donations`)
  .then(res => res.json())
  .then(json => {
    if (json.length) {
      if (latestDonation !== null) {
        let i = 0;
        while (latestDonation !== json[i].donationID) {
          i++;
        }

        i--;

        for (; i >= 0; i--) {
          addAlert('charitydonation', {
            user: json[i].displayName,
            amount: `\$${json[i].amount}`
          }, config.donordrive.alertduration);
        }
      }

      latestDonation = json[0].donationID;
    } else {
      latestDonation = '';
    }
  })
  .catch(err => {
    console.warn('failed to query DonorDrive');
    console.log(err);
  });
}

/**
 * Overlays
 */

// The interval for the tips display in milliseconds
const tipInterval = 15000;

// The tips display
const tipsElem = document.getElementById('tips');
if (tipsElem && config.tips) {
  let index = 0;

  tipsElem.innerText = 'Loading tips...';
  tipsElem.style.opacity = 1;

  setInterval(() => {
    tipsElem.style.opacity = 0;
    setTimeout(() => {
      tipsElem.innerText = `TIP: ${config.tips[index++ % config.tips.length]}`;
      tipsElem.style.opacity = 1;
    }, 500);
  }, tipInterval);
}

// The stream countdown
const countdownElem = document.getElementById('countdown');
if (countdownElem && config.schedule) {
  const next = getNextScheduled(config.schedule, true);

  setInterval(() => {
    const now = new Date();
    const diff = Math.floor((next.date.getTime() - now.getTime()) / 1000);

    let timeLeft = 'Soon...';
    if (diff >= 0) {
      timeLeft = Math.floor(diff / 60) + ':' + Number(diff % 60).toLocaleString('en-US', { minimumIntegerDigits: 2 });
    }

    countdownElem.innerHTML = `Starting: ${timeLeft}<br>${next.game}`;
  }, 100);
}

// The next stream display
const nextStreamElem = document.getElementById('nextstream');
if (nextStreamElem && config.schedule) {
  const next = getNextScheduled(config.schedule);

  const dateOptions = {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  };
  const dateFormatted = next.date.toLocaleDateString('en-US', dateOptions);

  nextStreamElem.innerHTML = `Next Stream:<br>${dateFormatted}<br>${next.game}`;
}

/**
 * Parse the dates in the schedule data.
 *
 * @param {array} schedule The schedule data
 * @param {boolean} useEnd Whether to use the end times of the streams
 */
function loadDates(schedule, useEnd) {

  const now = new Date();

  for (let i = schedule.length - 1; i >= 0; i--) {

    const date = new Date();

    const hour = useEnd ? schedule[i].hour + Math.floor(schedule[i].length / 60) : schedule[i].hour;
    const minute = useEnd ? schedule[i].minute + schedule[i].length % 60 : schedule[i].minute;

    if (now.getDay() > schedule[i].day || (now.getDay() == schedule[i].day && (now.getHours() > hour || (now.getHours() == hour && now.getMinutes() > minute)))) {
      date.setDate(now.getDate() + (7 - now.getDay() + schedule[i].day));
    } else {
      date.setDate(now.getDate() + (schedule[i].day - now.getDay()));
    }

    date.setHours(schedule[i].hour);
    date.setMinutes(schedule[i].minute);
    date.setSeconds(0);

    schedule[i].date = date;
    schedule[i].end = new Date(date.getTime() + (schedule[i].length * 60000));
  }
}

/**
 * Get the next scheduled stream.
 *
 * @param {array} schedule The schedule data
 * @param {boolean} useEnd Whether to use the end times of the streams
 */
function getNextScheduled(schedule, useEnd = false) {
  if (schedule[0].date === undefined) {
    loadDates(schedule, useEnd);
  }

  let next = schedule[0];

  for (let i = schedule.length - 1; i >= 0; i--) {
    if ((useEnd && schedule[i].end < next.end) || (!useEnd && schedule[i].date < next.date)) {
      next = schedule[i];
    }
  }

  return next;
}

/**
 * Sound effects
 */

// Queue of sounds ready to be played
const soundQueue = [];

/**
 * Add a new sound to the queue.
 *
 * @param {string} key The sound effect key
 */
function addSound(key) {
  soundQueue.push(key);

  if (soundQueue.length === 1) {
    playNextSound();
  }

  console.log('sfx', key);
}

/**
 * Play the next sound in the queue.
 */
function playNextSound() {
  if (!soundQueue.length) {
    return;
  }

  const soundElem = document.getElementById(`sfx_${soundQueue[0]}`);
  if (!soundElem) {
    return;
  }

  soundElem.currentTime = 0;
  soundElem.play();

  soundElem.onended = (() => {
    return () => {
      soundElem.onended = null;
      soundQueue.shift();
      playNextSound();
    };
  })();
}
