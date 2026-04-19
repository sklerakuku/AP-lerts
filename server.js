const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    // Настройки для Render
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;
const CARD_API_TOKEN = process.env.CARD_API_TOKEN; // Из переменных среды

// Проверка наличия токена при запуске
if (!CARD_API_TOKEN) {
    console.error('❌ ОШИБКА: Не указан CARD_API_TOKEN в переменных окружения!');
    console.error('Добавьте переменную CARD_API_TOKEN в настройках Render');
    process.exit(1);
}

// Для корректного парсинга raw body
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

// Статические файлы
app.use(express.static('public'));

// Главная страница с информацией
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

// Проверка статуса сервера
app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        connections: io.engine.clientsCount,
        uptime: process.uptime(),
        hosting: 'spmtv.onrender.com'
    });
});

// Тестовый эндпоинт (только для отладки)
app.get('/test-donation', (req, res) => {
    // Простая защита тестового режима
    const testKey = req.query.key;
    if (testKey !== 'test123') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    io.emit('new_donation', {
        username: "Тестовый_Игрок",
        amount: 500,
        comment: "Тестовый донат! Спасибо за стрим! 🎮",
        type: "incoming",
        id: 'test_' + Date.now(),
        createdAt: new Date().toISOString()
    });
    
    res.json({ success: true, message: 'Тестовый донат отправлен' });
});

// Обработка вебхука от SPWorlds
app.post('/webhook', (req, res) => {
    const rawBody = req.rawBody;
    const signature = req.headers['x-body-hash'];
    
    // Логируем входящий запрос
    console.log(`📨 [${new Date().toISOString()}] Получен вебхук`);
    
    // Проверка наличия подписи
    if (!signature) {
        console.error('❌ Отсутствует заголовок X-Body-Hash');
        return res.status(400).json({ error: 'Missing signature header' });
    }
    
    // Генерируем хеш для проверки
    const hash = crypto
        .createHmac('sha256', CARD_API_TOKEN)
        .update(Buffer.from(rawBody, 'utf8'))
        .digest('base64');
    
    const isValid = signature === hash;
    
    console.log(`🔐 Проверка подписи: ${isValid ? '✅ УСПЕШНО' : '❌ ОШИБКА'}`);
    
    if (!isValid) {
        console.error('❌ Неверная подпись вебхука!');
        return res.status(403).json({ error: 'Invalid signature' });
    }
    
    try {
        const { amount, type, sender, receiver, comment, createdAt, id } = req.body;
        
        // Подробное логирование
        console.log(`✅ Транзакция ${id}:`);
        console.log(`   Сумма: ${amount} АР`);
        console.log(`   Тип: ${type}`);
        console.log(`   Отправитель: ${sender?.username || 'Неизвестный'}`);
        console.log(`   Получатель: ${receiver?.username || 'Неизвестный'}`);
        console.log(`   Комментарий: ${comment || 'Нет'}`);
        console.log(`   Дата: ${createdAt}`);
        
        // Формируем данные для отправки в виджет
        const donationData = {
            id: id,
            amount: amount,
            type: type,
            username: sender?.username || "Анонимный даритель",
            senderNumber: sender?.number || null,
            receiver: receiver?.username || null,
            comment: comment || "",
            createdAt: createdAt,
            timestamp: new Date().toISOString()
        };
        
        // Отправляем всем подключенным виджетам
        io.emit('new_donation', donationData);
        
        console.log(`📤 Донат отправлен ${io.engine.clientsCount} подключенным клиентам`);
        
        res.status(200).json({ 
            status: 'OK', 
            message: 'Webhook processed successfully',
            clientsNotified: io.engine.clientsCount
        });
        
    } catch (error) {
        console.error('❌ Ошибка обработки вебхука:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Обработка подключений Socket.io
io.on('connection', (socket) => {
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    
    console.log(`🔌 [${new Date().toISOString()}] Новое подключение:`);
    console.log(`   ID: ${socket.id}`);
    console.log(`   IP: ${clientIp}`);
    console.log(`   Всего подключений: ${io.engine.clientsCount}`);
    
    // Отправляем приветственное сообщение
    socket.emit('welcome', {
        message: 'Подключено к серверу донатов SPWorlds',
        server: 'spmtv.onrender.com',
        timestamp: new Date().toISOString()
    });
    
    socket.on('disconnect', (reason) => {
        console.log(`🔌 [${new Date().toISOString()}] Отключение:`);
        console.log(`   ID: ${socket.id}`);
        console.log(`   Причина: ${reason}`);
        console.log(`   Осталось подключений: ${io.engine.clientsCount}`);
    });
    
    socket.on('error', (error) => {
        console.error(`❌ Ошибка сокета ${socket.id}:`, error);
    });
    
    // Пинг для поддержания соединения на Render
    socket.on('ping', () => {
        socket.emit('pong', { timestamp: Date.now() });
    });
});

// Запуск сервера
server.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 ====================================');
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Хостинг: spmtv.onrender.com`);
    console.log(`📡 Webhook URL: https://spmtv.onrender.com/webhook`);
    console.log(`🎮 Виджет: https://spmtv.onrender.com`);
    console.log(`📊 Статус: https://spmtv.onrender.com/status`);
    console.log(`🔑 Токен: ${CARD_API_TOKEN ? 'Загружен ✅' : '❌ ОТСУТСТВУЕТ'}`);
    console.log('🚀 ====================================');
});

// Graceful shutdown для Render
process.on('SIGTERM', () => {
    console.log('📴 Получен SIGTERM, закрываем сервер...');
    server.close(() => {
        console.log('✅ Сервер остановлен');
        process.exit(0);
    });
});