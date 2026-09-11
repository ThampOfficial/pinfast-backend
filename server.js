const express = require('express');
const cors = require('cors');
const generatePayload = require('promptpay-qr');
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

// ⚠️ ใส่เบอร์โทรศัพท์ที่ผูก PromptPay หรือเลขประจำตัวผู้เสียภาษี (13 หลัก) ของคุณตรงนี้
const PROMPTPAY_ACCOUNT = '0813999389'; 

const PRODUCTS = [
  { id: 1, name: 'Razer Gold PIN', price: 95 },
  { id: 2, name: 'Garena Shells', price: 142 },
  { id: 3, name: 'Steam Wallet Code', price: 335 },
  { id: 4, name: 'ROBLOX Gift Card', price: 340 }
];

let STOCK_CODES = [
  { id: 101, productId: 1, serial: 'RZ-2026-0001X', pin: '8841-9920-1123', status: 'AVAILABLE' },
  { id: 102, productId: 1, serial: 'RZ-2026-0002X', pin: '7741-5520-4412', status: 'AVAILABLE' },
  { id: 103, productId: 2, serial: 'GA-2026-9901A', pin: '1102-3344-5566', status: 'AVAILABLE' }
];

let ORDERS = [];

app.get('/', (req, res) => {
  res.send('PINFAST API Ready!');
});

// API สร้าง Order พร้อมสร้าง PromptPay QR Code จริง
app.post('/api/orders/create', async (req, res) => {
  try {
    const { productId, customerContact } = req.body;
    const product = PRODUCTS.find(p => p.id === Number(productId));

    if (!product) {
      return res.status(404).json({ success: false, message: 'ไม่พบสินค้า' });
    }

    const availableStock = STOCK_CODES.find(s => s.productId === Number(productId) && s.status === 'AVAILABLE');
    if (!availableStock) {
      return res.status(400).json({ success: false, message: 'สินค้าหมดชั่วคราว' });
    }

    const orderRef = 'PF-' + Date.now();
    const amount = product.price;

    // 1. สร้าง PromptPay Payload ตามมาตรฐาน EMVCo
    const payload = generatePayload(PROMPTPAY_ACCOUNT, { amount });

    // 2. แปลง Payload เป็น Image Data URL (Base64)
    const qrImageBase64 = await QRCode.toDataURL(payload, {
      color: { dark: '#000000', light: '#ffffff' },
      margin: 2,
      width: 300
    });

    const newOrder = {
      orderRef,
      productId: Number(productId),
      amount,
      stockId: availableStock.id,
      customerContact,
      status: 'PENDING',
      createdAt: new Date()
    };
    ORDERS.push(newOrder);

    res.json({
      success: true,
      orderRef,
      amount,
      qrImage: qrImageBase64, // ส่งรูป QR Code สแกนได้จริงกลับไปที่ Frontend
      message: 'สร้างออเดอร์สำเร็จ'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการสร้าง QR Code' });
  }
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
