// Vercel Web Analytics initialization
(function() {
  // Initialize the queue
  window.va = window.va || function() {
    (window.vaq = window.vaq || []).push(arguments);
  };

  // Inject Vercel Analytics script
  var script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/insights/script.js';
  
  var firstScript = document.getElementsByTagName('script')[0];
  if (firstScript && firstScript.parentNode) {
    firstScript.parentNode.insertBefore(script, firstScript);
  } else {
    document.head.appendChild(script);
  }
})();
