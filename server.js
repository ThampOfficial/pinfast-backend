const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// คลัง e-PIN จำลอง
let STOCK_CODES = [
  { id: 101, productId: 1, serial: 'RZ-2026-0001X', pin: '8841-9920-1123', status: 'AVAILABLE' },
  { id: 102, productId: 1, serial: 'RZ-2026-0002X', pin: '7741-5520-4412', status: 'AVAILABLE' },
  { id: 103, productId: 2, serial: 'GA-2026-9901A', pin: '1102-3344-5566', status: 'AVAILABLE' }
];

let ORDERS = [];

app.get('/', (req, res) => {
  res.send('PINFAST API Ready!');
});

app.post('/api/orders/create', (req, res) => {
  const { productId, customerContact } = req.body;
  const availableStock = STOCK_CODES.find(s => s.productId === Number(productId) && s.status === 'AVAILABLE');

  if (!availableStock) {
    return res.status(400).json({ success: false, message: 'สินค้าหมดชั่วคราว' });
  }

  const orderRef = 'PF-' + Date.now();
  const newOrder = { orderRef, productId, stockId: availableStock.id, customerContact, status: 'PENDING' };
  ORDERS.push(newOrder);

  res.json({ success: true, orderRef, message: 'สร้างออเดอร์สำเร็จ' });
});

app.post('/api/payment/webhook', (req, res) => {
  const { orderRef, status } = req.body;
  const order = ORDERS.find(o => o.orderRef === orderRef);

  if (order && status === 'SUCCESS') {
    order.status = 'PAID';
    const stockItem = STOCK_CODES.find(s => s.id === order.stockId);
    if (stockItem) stockItem.status = 'SOLD';

    return res.json({ success: true, message: 'ตัดสต็อกและส่งมอบสำเร็จ' });
  }
  res.status(400).json({ success: false, message: 'ทำรายการไม่สำเร็จ' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
