const express = require('express');
const cors = require('cors');
const generatePayload = require('promptpay-qr');
const QRCode = require('qrcode');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // รองรับ Base64 รูปสลิปขนาดใหญ่

// ⚠️ ใส่เบอร์ PromptPay ของคุณตรงนี้ (ตัวเลขล้วน)
const PROMPTPAY_ACCOUNT = '0813999389';

// ⚠️ หากใช้ SlipOK หรือ API เจ้าอื่น ให้นำ API Key มาใส่ตรงนี้
const SLIPOK_API_KEY = 'YOUR_SLIPOK_API_KEY'; 
const SLIPOK_BRANCH_ID = 'YOUR_BRANCH_ID';

const PRODUCTS = [
  { id: 1, name: 'Razer Gold PIN', price: 95 },
  { id: 2, name: 'Garena Shells', price: 142 },
  { id: 3, name: 'Steam Wallet Code', price: 335 },
  { id: 4, name: 'ROBLOX Gift Card', price: 340 }
];

// คลัง e-PIN จำลอง
let STOCK_CODES = [
  { id: 101, productId: 1, serial: 'RZ-2026-0001X', pin: '8841-9920-1123', status: 'AVAILABLE' },
  { id: 102, productId: 1, serial: 'RZ-2026-0002X', pin: '7741-5520-4412', status: 'AVAILABLE' },
  { id: 103, productId: 2, serial: 'GA-2026-9901A', pin: '1102-3344-5566', status: 'AVAILABLE' }
];

let ORDERS = [];
let USED_TRANSACTION_REFS = new Set(); // เก็บประวัติกันใช้สลิปซ้ำ

app.get('/', (req, res) => {
  res.send('PINFAST API Ready!');
});

// API สร้าง Order พร้อมสร้าง PromptPay QR Code
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
    const amount = Number(product.price);

    const sanitizedAccount = PROMPTPAY_ACCOUNT.replace(/[^0-9]/g, '');
    const payload = generatePayload(sanitizedAccount, { amount });

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
      qrImage: qrImageBase64,
      message: 'สร้างออเดอร์สำเร็จ'
    });
  } catch (err) {
    console.error('QR Generation Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการสร้าง QR Code' });
  }
});

// API สำหรับตรวจสลิปโอนเงิน (Slip Verification)
app.post('/api/payment/verify-slip', async (req, res) => {
  try {
    const { orderRef, slipPayload } = req.body;
    const order = ORDERS.find(o => o.orderRef === orderRef);

    if (!order) {
      return res.status(404).json({ success: false, message: 'ไม่พบคำสั่งซื้อนี้' });
    }

    if (order.status === 'PAID') {
      const stockItem = STOCK_CODES.find(s => s.id === order.stockId);
      return res.json({
        success: true,
        message: 'ออเดอร์นี้ชำระเงินเรียบร้อยแล้ว',
        item: { serial: stockItem.serial, pin: stockItem.pin }
      });
    }

    // ------------------------------------------------------------------
    // โหมดจำลองตรวจสลิป (สลับไปใช้ SlipOK / API จริงเมื่อสมัครบริการได้เลย)
    // ------------------------------------------------------------------
    // ในที่นี้หากลูกค้าส่ง slipPayload หรือแนบสลิปมา ถือว่าผ่านการตรวจ
    let verifiedAmount = order.amount; // จำลองยอดเงินที่ตรวจได้จากสลิป
    let transactionRef = 'SLIP-REF-' + Date.now(); // จำลองเลขที่รายการในสลิป

    /* 
    // ตัวอย่างการยิง API จริงหา SlipOK:
    const slipokResponse = await axios.post(
      `https://api.slipok.com/api/line/apikey/${SLIPOK_BRANCH_ID}`,
      { data: slipPayload, log: true },
      { headers: { 'x-authorization': SLIPOK_API_KEY, 'Content-Type': 'application/json' } }
    );
    verifiedAmount = slipokResponse.data.data.amount;
    transactionRef = slipokResponse.data.data.transRef;
    */

    // 1. ตรวจสอบว่าสลิปนี้เคยถูกใช้ไปแล้วหรือยัง
    if (USED_TRANSACTION_REFS.has(transactionRef)) {
      return res.status(400).json({ success: false, message: 'สลิปนี้ถูกใช้งานไปแล้ว' });
    }

    // 2. ตรวจสอบว่ายอดเงินในสลิปตรงกับยอดคำสั่งซื้อหรือไม่
    if (Number(verifiedAmount) !== Number(order.amount)) {
      return res.status(400).json({
        success: false,
        message: `ยอดเงินในสลิป (฿${verifiedAmount}) ไม่ตรงกับยอดคำสั่งซื้อ (฿${order.amount})`
      });
    }

    // 3. บันทึกว่าสลิปถูกใช้งานแล้ว และอัปเดตสถานะออเดอร์
    USED_TRANSACTION_REFS.add(transactionRef);
    order.status = 'PAID';

    // 4. ตัดสต็อก e-PIN
    const stockItem = STOCK_CODES.find(s => s.id === order.stockId);
    if (stockItem) {
      stockItem.status = 'SOLD';
    }

    res.json({
      success: true,
      message: 'ตรวจสอบสลิปสำเร็จ! ชำระเงินเรียบร้อย',
      item: {
        serial: stockItem ? stockItem.serial : 'N/A',
        pin: stockItem ? stockItem.pin : 'N/A'
      }
    });

  } catch (err) {
    console.error('Slip Verify Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการตรวจสอบสลิป' });
  }
});

// Webhook จำลองเพื่อ Backward Compatibility
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
