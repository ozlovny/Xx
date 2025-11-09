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
