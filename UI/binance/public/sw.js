self.addEventListener("push", function (event) {
  const data = event.data.text();

  event.waitUntil(
    self.registration.showNotification("Binance Bot", {
      body: data,
      icon: "/logo.png" // add your logo in public folder
    })
  );
});
