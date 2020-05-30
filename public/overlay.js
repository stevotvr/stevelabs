'use strict'

const alertQueue = [];

const socket = io('//' + window.location.host);

socket.on('connect', () => {
  console.log('connected to socket');
});

socket.on('disconnect', () => {
  console.log('socket connection lost');
});

socket.on('alert', (type, params, duration) => {
  alertQueue.push({
    type: type,
    params: params,
    duration: duration
  });

  if (alertQueue.length === 1) {
    showNextAlert();
  }

  console.log(type, params, duration);
});

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
    videoElems[0].play();
  }

  const audioElems = alertElem.getElementsByTagName('audio');
  if (audioElems && audioElems.length) {
    audioElems[0].play();
  }
}
