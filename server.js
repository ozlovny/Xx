// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Инициализация базы данных
const db = new sqlite3.Database(
    process.env.DATABASE_PATH || './database.db',
    (err) => {
        if (err) {
            console.error('Ошибка подключения к БД:', err);
        } else {
            console.log('Подключено к SQLite базе данных');
            initDatabase();
        }
    }
);

// Создание таблиц
function initDatabase() {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER UNIQUE NOT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT,
            balance INTEGER DEFAULT 0,
            ads_watched INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_active DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Ошибка создания таблицы users:', err);
        } else {
            console.log('Таблица users готова');
        }
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS ad_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            reward INTEGER DEFAULT 1,
            watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `, (err) => {
        if (err) {
            console.error('Ошибка создания таблицы ad_history:', err);
        } else {
            console.log('Таблица ad_history готова');
        }
    });
}

// Health check для Railway
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API: Получить или создать профиль пользователя
app.post('/api/profile', (req, res) => {
    const { telegram_id, first_name, last_name } = req.body;

    if (!telegram_id || !first_name) {
        return res.status(400).json({ error: 'Telegram ID и имя обязательны' });
    }

    // Проверяем существование пользователя
    db.get(
        'SELECT * FROM users WHERE telegram_id = ?',
        [telegram_id],
        (err, user) => {
            if (err) {
                console.error('Ошибка поиска пользователя:', err);
                return res.status(500).json({ error: 'Ошибка сервера' });
            }

            if (user) {
                // Обновляем last_active
                db.run(
                    'UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE telegram_id = ?',
                    [telegram_id]
                );
                return res.json(user);
            } else {
                // Создаем нового пользователя
                db.run(
                    `INSERT INTO users (telegram_id, first_name, last_name) 
                     VALUES (?, ?, ?)`,
                    [telegram_id, first_name, last_name || ''],
                    function(err) {
                        if (err) {
                            console.error('Ошибка создания пользователя:', err);
                            return res.status(500).json({ error: 'Ошибка создания профиля' });
                        }

                        // Получаем созданного пользователя
                        db.get(
                            'SELECT * FROM users WHERE id = ?',
                            [this.lastID],
                            (err, newUser) => {
                                if (err) {
                                    return res.status(500).json({ error: 'Ошибка получения профиля' });
                                }
                                res.status(201).json(newUser);
                            }
                        );
                    }
                );
            }
        }
    );
});

// API: Просмотр рекламы и начисление награды
app.post('/api/watch-ad', (req, res) => {
    const { telegram_id } = req.body;

    if (!telegram_id) {
        return res.status(400).json({ error: 'Telegram ID обязателен' });
    }

    db.serialize(() => {
        // Получаем пользователя
        db.get(
            'SELECT * FROM users WHERE telegram_id = ?',
            [telegram_id],
            (err, user) => {
                if (err) {
                    console.error('Ошибка поиска пользователя:', err);
                    return res.status(500).json({ error: 'Ошибка сервера' });
                }

                if (!user) {
                    return res.status(404).json({ error: 'Пользователь не найден' });
                }

                const reward = 1;

                // Обновляем баланс и счетчик просмотров
                db.run(
                    `UPDATE users 
                     SET balance = balance + ?, 
                         ads_watched = ads_watched + 1,
                         last_active = CURRENT_TIMESTAMP 
                     WHERE telegram_id = ?`,
                    [reward, telegram_id],
                    function(err) {
                        if (err) {
                            console.error('Ошибка обновления баланса:', err);
                            return res.status(500).json({ error: 'Ошибка начисления награды' });
                        }

                        // Записываем в историю
                        db.run(
                            'INSERT INTO ad_history (user_id, reward) VALUES (?, ?)',
                            [user.id, reward]
                        );

                        // Получаем обновленные данные пользователя
                        db.get(
                            'SELECT * FROM users WHERE telegram_id = ?',
                            [telegram_id],
                            (err, updatedUser) => {
                                if (err) {
                                    return res.status(500).json({ error: 'Ошибка получения данных' });
                                }
                                res.json(updatedUser);
                            }
                        );
                    }
                );
            }
        );
    });
});

// API: Получить статистику пользователя
app.get('/api/stats/:telegram_id', (req, res) => {
    const { telegram_id } = req.params;

    db.get(
        `SELECT 
            u.*,
            COUNT(ah.id) as total_ads,
            SUM(ah.reward) as total_rewards
         FROM users u
         LEFT JOIN ad_history ah ON u.id = ah.user_id
         WHERE u.telegram_id = ?
         GROUP BY u.id`,
        [telegram_id],
        (err, stats) => {
            if (err) {
                console.error('Ошибка получения статистики:', err);
                return res.status(500).json({ error: 'Ошибка сервера' });
            }

            if (!stats) {
                return res.status(404).json({ error: 'Пользователь не найден' });
            }

            res.json(stats);
        }
    );
});

// API: Получить историю просмотров рекламы
app.get('/api/ad-history/:telegram_id', (req, res) => {
    const { telegram_id } = req.params;
    const limit = parseInt(req.query.limit) || 10;

    db.all(
        `SELECT ah.* 
         FROM ad_history ah
         JOIN users u ON ah.user_id = u.id
         WHERE u.telegram_id = ?
         ORDER BY ah.watched_at DESC
         LIMIT ?`,
        [telegram_id, limit],
        (err, history) => {
            if (err) {
                console.error('Ошибка получения истории:', err);
                return res.status(500).json({ error: 'Ошибка сервера' });
            }

            res.json(history);
        }
    );
});

// Обработка корневого маршрута
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📱 URL: http://localhost:${PORT}`);
    console.log(`🌍 Окружение: ${process.env.NODE_ENV || 'development'}`);
});

// Корректное закрытие при завершении
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown() {
    console.log('\n🛑 Получен сигнал завершения...');
    db.close((err) => {
        if (err) {
            console.error('Ошибка закрытия БД:', err);
        }
        console.log('✅ База данных закрыта');
        process.exit(0);
    });
}
