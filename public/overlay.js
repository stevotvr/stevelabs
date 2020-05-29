var socket = io('//' + window.location.host);

var alertElem = document.getElementById('alert-container');
var messageElem = document.getElementById('message');
var videoElem = document.getElementById('video');
var soundElem = document.getElementById('sound');

socket.on('connect', () => {
  console.log('connected to socket');
});

socket.on('disconnect', () => {
  console.log('socket connection lost');
});

socket.on('alert', (message, graphic, sound, duration) => {
  alertElem.style.opacity = 1;
  setTimeout(() => {
    alertElem.style.opacity = 0;
  }, duration);

  if (message) {
    messageElem.innerText = message;
  }

  if (graphic) {
    videoElem.src = '../media/' + graphic;
    videoElem.play();
  }

  if (sound) {
    soundElem.src = '../media/' + sound;
    soundElem.play();
  }

  console.log(message, graphic, sound, duration);
});
