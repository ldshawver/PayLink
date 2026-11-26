/* Fills [data-trial-days] from the platform trial-length setting.
   The HTML already says 30, which is the default when this request fails. */
(function () {
  fetch("/api/public/trial-offer", { credentials: "same-origin" })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (data) {
      var days = data && Number(data.trialLengthDays);
      if (!Number.isInteger(days) || days < 1) return;
      var nodes = document.querySelectorAll("[data-trial-days]");
      for (var i = 0; i < nodes.length; i++) nodes[i].textContent = String(days);
    })
    .catch(function () {});
})();
