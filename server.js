const WebSocket = require('ws');

// ایجاد سرور وب‌سوکت روی پورت 8080
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', function connection(ws) {
  console.log('یک کلاینت جدید متصل شد.');

  ws.on('message', function incoming(message) {
    console.log('دریافت شده: %s', message);

    // ارسال پاسخ به کلاینت
    ws.send(`سرور دریافت کرد: ${message}`);
  });
  ws.on('error', function(error) {
    console.error('خطا در اتصال:', error);
  });
  ws.on('close', function close() {
    console.log('کلاینت قطع شد.');
  });
});

console.log('سرور وب‌سوکت روی پورت 8080 اجرا شد.');