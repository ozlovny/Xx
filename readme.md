# 📦 TELEGRAM MINI APP - ВСЕ ФАЙЛЫ

## 📁 Структура проекта
```
telegram-mini-app/
├── package.json
├── server.js
├── railway.json
├── netlify.toml
├── .gitignore
├── netlify/
│   └── functions/
│       └── api.js
└── public/
    └── index.html
```

---

# ФАЙЛ 1: package.json

```json
{
  "name": "telegram-mini-app-rewards",
  "version": "1.0.0",
  "description": "Telegram Mini App с AdSonar интеграцией для просмотра рекламы",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "keywords": [
    "telegram",
    "mini-app",
    "adsonar",
    "rewards"
  ],
  "author": "",
  "license": "MIT",
  "engines": {
    "node": ">=18.x"
  },
  "dependencies": {
    "express": "^4.18.2",
    "sqlite3": "^5.1.7",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
```

---

# ФАЙЛ 2: server.js

```javascript
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
```

---

# ФАЙЛ 3: railway.json

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "node server.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

---

# ФАЙЛ 4: netlify.toml

```toml
[build]
  command = "npm install"
  functions = "netlify/functions"
  publish = "public"

[functions]
  node_bundler = "esbuild"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/api/:splat"
  status = 200

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

---

# ФАЙЛ 5: .gitignore

```
node_modules/
database.db
.env
*.log
.DS_Store
.netlify/
dist/
```

---

# ФАЙЛ 6: netlify/functions/api.js

```javascript
// netlify/functions/api.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Инициализация базы данных
const dbPath = path.join('/tmp', 'database.db');
let db = null;

function getDatabase() {
  if (!db) {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('DB Error:', err);
      } else {
        initDatabase();
      }
    });
  }
  return db;
}

function initDatabase() {
  const database = getDatabase();
  
  database.run(`
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
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS ad_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      reward INTEGER DEFAULT 1,
      watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
}

// Основной обработчик
exports.handler = async (event, context) => {
  const database = getDatabase();
  
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const path = event.path.replace('/.netlify/functions/api', '');
  const method = event.httpMethod;

  try {
    // Profile endpoint
    if (path === '/profile' && method === 'POST') {
      const { telegram_id, first_name, last_name } = JSON.parse(event.body);

      if (!telegram_id || !first_name) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Telegram ID и имя обязательны' })
        };
      }

      return new Promise((resolve, reject) => {
        database.get(
          'SELECT * FROM users WHERE telegram_id = ?',
          [telegram_id],
          (err, user) => {
            if (err) {
              resolve({
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Ошибка сервера' })
              });
              return;
            }

            if (user) {
              database.run(
                'UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE telegram_id = ?',
                [telegram_id]
              );
              resolve({
                statusCode: 200,
                headers,
                body: JSON.stringify(user)
              });
            } else {
              database.run(
                'INSERT INTO users (telegram_id, first_name, last_name) VALUES (?, ?, ?)',
                [telegram_id, first_name, last_name || ''],
                function(err) {
                  if (err) {
                    resolve({
                      statusCode: 500,
                      headers,
                      body: JSON.stringify({ error: 'Ошибка создания профиля' })
                    });
                    return;
                  }

                  database.get(
                    'SELECT * FROM users WHERE id = ?',
                    [this.lastID],
                    (err, newUser) => {
                      if (err) {
                        resolve({
                          statusCode: 500,
                          headers,
                          body: JSON.stringify({ error: 'Ошибка получения профиля' })
                        });
                        return;
                      }
                      resolve({
                        statusCode: 201,
                        headers,
                        body: JSON.stringify(newUser)
                      });
                    }
                  );
                }
              );
            }
          }
        );
      });
    }

    // Watch ad endpoint
    if (path === '/watch-ad' && method === 'POST') {
      const { telegram_id } = JSON.parse(event.body);

      if (!telegram_id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Telegram ID обязателен' })
        };
      }

      return new Promise((resolve, reject) => {
        database.get(
          'SELECT * FROM users WHERE telegram_id = ?',
          [telegram_id],
          (err, user) => {
            if (err || !user) {
              resolve({
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Пользователь не найден' })
              });
              return;
            }

            const reward = 1;

            database.run(
              'UPDATE users SET balance = balance + ?, ads_watched = ads_watched + 1, last_active = CURRENT_TIMESTAMP WHERE telegram_id = ?',
              [reward, telegram_id],
              function(err) {
                if (err) {
                  resolve({
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({ error: 'Ошибка начисления награды' })
                  });
                  return;
                }

                database.run(
                  'INSERT INTO ad_history (user_id, reward) VALUES (?, ?)',
                  [user.id, reward]
                );

                database.get(
                  'SELECT * FROM users WHERE telegram_id = ?',
                  [telegram_id],
                  (err, updatedUser) => {
                    if (err) {
                      resolve({
                        statusCode: 500,
                        headers,
                        body: JSON.stringify({ error: 'Ошибка получения данных' })
                      });
                      return;
                    }
                    resolve({
                      statusCode: 200,
                      headers,
                      body: JSON.stringify(updatedUser)
                    });
                  }
                );
              }
            );
          }
        );
      });
    }

    // Default response
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Endpoint not found' })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
```

---

# ФАЙЛ 7: public/index.html

```html
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rewards App</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: var(--tg-theme-bg-color, #ffffff);
            color: var(--tg-theme-text-color, #000000);
            padding: 20px;
            min-height: 100vh;
        }

        .container {
            max-width: 500px;
            margin: 0 auto;
        }

        .profile-card {
            background: var(--tg-theme-secondary-bg-color, #f0f0f0);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 20px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .profile-header {
            display: flex;
            align-items: center;
            gap: 16px;
            margin-bottom: 20px;
        }

        .avatar {
            width: 64px;
            height: 64px;
            border-radius: 50%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            font-weight: bold;
            color: white;
        }

        .profile-info h2 {
            font-size: 20px;
            margin-bottom: 4px;
        }

        .user-id {
            font-size: 12px;
            opacity: 0.6;
        }

        .balance-section {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 12px;
            padding: 20px;
            text-align: center;
            color: white;
            margin-bottom: 16px;
        }

        .balance-label {
            font-size: 14px;
            opacity: 0.9;
            margin-bottom: 8px;
        }

        .balance-amount {
            font-size: 48px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .star-icon {
            font-size: 40px;
        }

        .watch-ad-btn {
            width: 100%;
            padding: 16px;
            background: var(--tg-theme-button-color, #3390ec);
            color: var(--tg-theme-button-text-color, #ffffff);
            border: none;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .watch-ad-btn:hover {
            opacity: 0.9;
        }

        .watch-ad-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .loading {
            text-align: center;
            padding: 40px;
            font-size: 18px;
        }

        .error {
            background: #ff4444;
            color: white;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 16px;
            display: none;
        }

        .error.show {
            display: block;
        }

        .stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-top: 16px;
        }

        .stat-item {
            background: var(--tg-theme-bg-color, #ffffff);
            padding: 16px;
            border-radius: 8px;
            text-align: center;
        }

        .stat-value {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 4px;
        }

        .stat-label {
            font-size: 12px;
            opacity: 0.6;
        }
    </style>
</head>
<body>
    <div class="container">
        <div id="loading" class="loading">Загрузка...</div>
        <div id="error" class="error"></div>
        
        <div id="app" style="display: none;">
            <div class="profile-card">
                <div class="profile-header">
                    <div class="avatar" id="avatar">U</div>
                    <div class="profile-info">
                        <h2 id="userName">Пользователь</h2>
                        <div class="user-id">ID: <span id="userId"></span></div>
                    </div>
                </div>

                <div class="balance-section">
                    <div class="balance-label">Ваш баланс</div>
                    <div class="balance-amount">
                        <span id="balance">0</span>
                        <span class="star-icon">⭐</span>
                    </div>
                </div>

                <button id="watchAdBtn" class="watch-ad-btn">
                    <span>📺</span>
                    Смотреть рекламу (+1 ⭐)
                </button>

                <div class="stats">
                    <div class="stat-item">
                        <div class="stat-value" id="adsWatched">0</div>
                        <div class="stat-label">Реклам просмотрено</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value" id="totalEarned">0</div>
                        <div class="stat-label">Всего заработано</div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Используйте переменную окружения для API URL или localhost по умолчанию
        const API_URL = window.location.hostname === 'localhost' 
            ? 'http://localhost:3000/api'
            : '/api';
        
        let tg = window.Telegram.WebApp;
        let user = null;
        let AdSonarSDK = null;

        // Инициализация Telegram WebApp
        tg.ready();
        tg.expand();

        // Функция для показа ошибок
        function showError(message) {
            const errorEl = document.getElementById('error');
            errorEl.textContent = message;
            errorEl.classList.add('show');
            setTimeout(() => {
                errorEl.classList.remove('show');
            }, 5000);
        }

        // Загрузка профиля пользователя
        async function loadProfile() {
            try {
                const telegramUser = tg.initDataUnsafe?.user;
                
                // Для тестирования используем моковые данные, если нет Telegram
                const userId = telegramUser?.id || 123456789;
                const firstName = telegramUser?.first_name || 'Тестовый';
                const lastName = telegramUser?.last_name || 'Пользователь';

                const response = await fetch(`${API_URL}/profile`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        telegram_id: userId,
                        first_name: firstName,
                        last_name: lastName
                    })
                });

                if (!response.ok) {
                    throw new Error('Ошибка загрузки профиля');
                }

                user = await response.json();
                displayProfile(user);
                
                document.getElementById('loading').style.display = 'none';
                document.getElementById('app').style.display = 'block';

                // Инициализация AdSonar
                initAdSonar();
            } catch (error) {
                console.error('Error loading profile:', error);
                showError('Ошибка загрузки профиля');
                document.getElementById('loading').textContent = 'Ошибка загрузки';
            }
        }

        // Отображение профиля
        function displayProfile(userData) {
            const fullName = `${userData.first_name} ${userData.last_name || ''}`.trim();
            document.getElementById('userName').textContent = fullName;
            document.getElementById('userId').textContent = userData.telegram_id;
            document.getElementById('balance').textContent = userData.balance;
            document.getElementById('adsWatched').textContent = userData.ads_watched;
            document.getElementById('totalEarned').textContent = userData.balance;
            
            // Аватар с первой буквой имени
            const firstLetter = userData.first_name.charAt(0).toUpperCase();
            document.getElementById('avatar').textContent = firstLetter;
        }

        // Инициализация AdSonar
        function initAdSonar() {
            // ВАЖНО: Замените на ваш реальный Block ID из AdSonar панели
            const ADSONAR_BLOCK_ID = 'YOUR_ADSONAR_BLOCK_ID';
            
            try {
                // Инициализация AdSonar SDK
                if (window.AdController) {
                    AdSonarSDK = window.AdController;
                    console.log('AdSonar SDK инициализирован');
                } else {
                    console.warn('AdSonar SDK не загружен');
                }
            } catch (error) {
                console.error('Ошибка инициализации AdSonar:', error);
            }
        }

        // Просмотр рекламы через AdSonar
        async function watchAd() {
            const btn = document.getElementById('watchAdBtn');
            btn.disabled = true;
            btn.textContent = 'Загрузка рекламы...';

            try {
                // ВАЖНО: Замените на ваш Block ID
                const ADSONAR_BLOCK_ID = 'YOUR_ADSONAR_BLOCK_ID';

                if (window.AdController) {
                    // Показываем рекламу через AdSonar
                    window.AdController.show({
                        blockId: ADSONAR_BLOCK_ID,
                        onReward: async () => {
                            // Реклама успешно просмотрена
                            await handleAdReward();
                        },
                        onClose: () => {
                            // Реклама закрыта
                            btn.disabled = false;
                            btn.innerHTML = '<span>📺</span> Смотреть рекламу (+1 ⭐)';
                }
            } catch (error) {
                console.error('Error watching ad:', error);
                showError('Ошибка при просмотре рекламы');
                btn.disabled = false;
                btn.innerHTML = '<span>📺</span> Смотреть рекламу (+1 ⭐)';
            }
        }

        // Обработка награды за рекламу
        async function handleAdReward() {
            try {
                const response = await fetch(`${API_URL}/watch-ad`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        telegram_id: user.telegram_id
                    })
                });

                if (!response.ok) {
                    throw new Error('Ошибка начисления награды');
                }

                const updatedUser = await response.json();
                user = updatedUser;
                displayProfile(user);
                
                // Показываем уведомление в Telegram
                tg.showAlert('Поздравляем! Вы получили 1 ⭐');
            } catch (error) {
                console.error('Error handling ad reward:', error);
                showError('Ошибка начисления награды');
            }
        }

        // События
        document.getElementById('watchAdBtn').addEventListener('click', watchAd);

        // Загрузка AdSonar SDK
        // ВАЖНО: Свяжитесь с @adsonar_manager в Telegram для получения SDK
        const adsScript = document.createElement('script');
        adsScript.src = 'https://ad.adsonar.co/sdk.js'; // Пример URL, уточните актуальный
        adsScript.async = true;
        adsScript.onerror = () => {
            console.warn('AdSonar SDK не загружен, используется тестовый режим');
        };
        document.head.appendChild(adsScript);

        // Инициализация приложения
        loadProfile();
    </script>
</body>
</html>
```

---

# 🚀 ИНСТРУКЦИЯ ПО УСТАНОВКЕ

## 1. Создание проекта

```bash
# Создайте папку проекта
mkdir telegram-mini-app
cd telegram-mini-app

# Создайте структуру папок
mkdir public
mkdir -p netlify/functions

# Создайте все файлы из списка выше
```

## 2. Установка зависимостей

```bash
npm install
```

## 3. Локальный запуск

```bash
npm start
```

Откройте: http://localhost:3000

---

# 📡 ДЕПЛОЙ НА RAILWAY

## Шаг 1: Создайте GitHub репозиторий

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin YOUR_REPO_URL
git push -u origin main
```

## Шаг 2: Деплой на Railway

1. Откройте https://railway.app
2. Нажмите "New Project"
3. Выберите "Deploy from GitHub repo"
4. Выберите ваш репозиторий
5. Railway автоматически задеплоит проект
6. Скопируйте URL (например: https://your-app.up.railway.app)

---

# 🌐 ДЕПЛОЙ НА NETLIFY

## Через GitHub

1. Откройте https://app.netlify.com
2. "Add new site" → "Import from Git"
3. Выберите ваш репозиторий
4. Build settings автоматически определятся
5. Deploy!

## Через CLI

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify deploy --prod
```

---

# 🤖 НАСТРОЙКА TELEGRAM BOT

## 1. Создайте бота

1. Откройте @BotFather в Telegram
2. Отправьте `/newbot`
3. Следуйте инструкциям
4. Сохраните токен

## 2. Создайте Mini App

1. В @BotFather отправьте `/newapp`
2. Выберите вашего бота
3. Название: "Rewards App"
4. Описание: "Смотри рекламу и зарабатывай Stars"
5. Загрузите иконку 640x360
6. **URL приложения:**
   - Railway: `https://your-app.up.railway.app`
   - Netlify: `https://your-app.netlify.app`

---

# 🎯 НАСТРОЙКА ADSONAR

## 1. Регистрация

1. Перейдите на https://www.adsonar.co
2. Нажмите "Get Started" или "Telegram Publishers"
3. Или напишите @adsonar_manager в Telegram

## 2. Получение Block ID

1. Войдите в Partner Portal
2. Создайте новый Ad Unit
3. Скопируйте **Block ID**

## 3. Интеграция

В файле `public/index.html` замените:

```javascript
const ADSONAR_BLOCK_ID = 'YOUR_ADSONAR_BLOCK_ID';
```

на ваш реальный Block ID (в двух местах в коде).

## 4. Уточните URL SDK

Свяжитесь с AdSonar для актуального URL SDK:

```javascript
adsScript.src = 'https://ad.adsonar.co/sdk.js'; // Уточните в документации
```

---

# ✅ ГОТОВО!

Теперь у вас есть полностью рабочее Telegram Mini App с:

- ✅ Автоматическим созданием профилей
- ✅ Системой баланса Stars
- ✅ Интеграцией AdSonar для рекламы
- ✅ Начислением 1 ⭐ за просмотр
- ✅ Статистикой просмотров
- ✅ SQLite базой данных
- ✅ Готовностью к деплою на Railway/Netlify

---

# 📞 ПОДДЕРЖКА

- **AdSonar:** @adsonar_manager
- **Railway:** https://discord.gg/railway
- **Netlify:** https://www.netlify.com/support/

---

# 🔧 ПОЛЕЗНЫЕ КОМАНДЫ

```bash
# Локальный запуск
npm start

# Деплой на Railway
railway up

# Деплой на Netlify
netlify deploy --prod

# Проверка логов Railway
railway logs

# Проверка логов Netlify
netlify logs:function api
``` Смотреть рекламу (+1 ⭐)';
                        },
                        onError: (error) => {
                            console.error('AdSonar error:', error);
                            showError('Реклама недоступна. Попробуйте позже.');
                            btn.disabled = false;
                            btn.innerHTML = '<span>📺</span> Смотреть рекламу (+1 ⭐)';
                        }
                    });
                } else {
                    // Симуляция для тестирования без AdSonar
                    console.log('AdSonar SDK не найден, используем симуляцию');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await handleAdReward();
                    btn.disabled = false;
                    btn.innerHTML = '<span>📺</span>
