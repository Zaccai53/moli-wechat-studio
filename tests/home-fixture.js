'use strict';

document.querySelector('.home-repost').addEventListener('click', () => {
  document.querySelector('.share_article_dialog').style.display = 'block';
  window.repostOpened = (window.repostOpened || 0) + 1;
});
