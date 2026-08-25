# Автотесты регистрации — gcplaying0175.com

Playwright + TypeScript, отчёты в Allure.

## Как устроена форма (проверено вживую 24.08.2026)

Регистрация открывается модальным окном (`data-testid="signup-popup"`)
по клику на кнопку **Register** в шапке (кнопка видна только для
анонимной сессии — если браузер уже залогинен, вместо неё показывается
баланс и "Log out").

Поля формы: Currency (USD/EUR, по умолчанию USD), Country (по умолчанию
United Arab Emirates), Code — код телефона (по умолчанию +971), Phone,
Email, Password. **Поля подтверждения пароля и чекбокса согласия с
условиями в форме нет** — согласие с Terms & Conditions и 18+
подразумевается текстом со ссылкой под кнопкой отправки. Капчи
(reCAPTCHA/hCaptcha/Turnstile) в разметке формы не обнаружено.

Валидация полностью клиентская: кнопка **Sign up** имеет нативный
атрибут `disabled`, который снимается только когда все поля валидны.
Пароль дополнительно проверяется живым чек-листом из 5 пунктов
("Between 8-30 characters", "At least one number", "No spaces",
"At least one lowercase", "At least one capital") — каждый пункт
подсвечивается ✓/✗ по мере ввода через CSS-классы
`WizPasswordHints_true__*` / `WizPasswordHints_false__*`.

## ⚠️ Известные ограничения

Чтобы не плодить лишние аккаунты на проде во время разведки формы, я
**не выполнял реальную отправку формы** — поэтому два момента
проверялись логически, а не вживую, и их стоит перепроверить при первом
реальном прогоне:

1. **Экран успешной регистрации** (`RegistrationPage.expectSuccess`) —
   сейчас проверяется как закрытие модалки + появление "Log out" или
   кнопки "Deposit". Если после реальной регистрации показывается,
   например, приветственная модалка с бонусом — обновите этот метод.
2. **Сообщение о повторной регистрации с занятым email** — тест
   `@duplicate` сейчас проверяет только то, что модалка НЕ закрывается
   (т.е. успеха не произошло), но не конкретный текст ошибки. Если
   сервер показывает текст вида "Email already exists" — стоит добавить
   точную проверку этого текста в `tests/registration.spec.ts`.

Оба места отмечены комментариями `TODO`-по смыслу прямо в коде.

## Установка

```bash
npm install
npx playwright install --with-deps chromium firefox
```

## Запуск тестов

```bash
npm test                 # все браузеры (chromium, firefox, mobile-chrome)
npx playwright test --project=chromium
npm run test:headed      # с видимым браузером
npm run test:debug       # пошаговая отладка
npx playwright test -g "Успешная регистрация"   # конкретный тест
```

Переопределить адрес сайта (например, для стейджа):

```bash
BASE_URL=https://staging.gcplaying0175.com/ npm test
```

⚠️ Тесты `@positive` и `@duplicate` выполняют реальную отправку формы
регистрации. Запускайте их на тестовом окружении/тестовыми email
(mailinator.com), либо уберите тег из прогона на проде:

```bash
npx playwright test --grep-invert "@positive|@duplicate"
```

## Allure-отчёт

Тесты пишут результаты в `allure-results/` через `allure-playwright`.

```bash
npm run report            # собрать и открыть HTML-отчёт Allure
# или по отдельности:
npm run report:generate   # allure generate allure-results --clean -o allure-report
npm run report:open       # allure open allure-report
```

Для CI (например, GitHub Actions) отчёт можно публиковать через
`allure-results/` как артефакт и рендерить `allure generate` в отдельном
шаге (нужна Java для `allure-commandline`).

## Запуск через GitHub Actions (кнопка для коллег)

Репозиторий: https://github.com/Ivansako/gcplaying-registration-autotests

1. Откройте вкладку **Actions** → workflow **"Run autotests"**.
2. Нажмите **Run workflow**, выберите:
   - `spec` — какой набор тестов гонять (`registration` / `game-providers` / `all`);
   - `include_form_submitting` — включать ли `@positive`/`@duplicate` (создают
     реальный аккаунт на проде — по умолчанию выключено);
   - `base_url` — опционально, другой адрес (например, стейджинг).
3. После завершения прогона откройте сам run → внизу секция **Artifacts** →
   скачайте `allure-report`, распакуйте и откройте `index.html` локально.

⚠️ GitHub Pages для приватных репозиториев на бесплатном тарифе недоступен,
поэтому отчёт публикуется как скачиваемый артефакт, а не постоянная ссылка.
При переходе на GitHub Pro/Team/Enterprise можно переключить публикацию на
Pages для отчёта по одному стабильному URL для всей команды.

Чтобы у коллег был доступ к репозиторию — добавьте их в
**Settings → Collaborators and teams**.

## Структура проекта

```
playwright.config.ts       — конфиг Playwright + allure-playwright reporter
pages/RegistrationPage.ts  — Page Object формы регистрации
utils/test-data.ts         — генерация тестовых данных (faker)
tests/registration.spec.ts — сценарии регистрации
```

## Покрытые сценарии

Названия тестов и шаги — на английском языке (см. `tests/registration.spec.ts`).

- Successful registration with valid data (`@smoke @positive`)
- Sign up button stays disabled while the form is empty (`@negative`)
- Invalid email formats — button stays disabled (`@negative @email`)
- Invalid phone number formats: too short, too long, letters only,
  non-digit separators — button stays disabled (`@negative @phone`)
- Passwords each violating exactly one checklist requirement (too
  short, too long, no digit, contains a space, no lowercase, no
  uppercase) — the corresponding item is marked unmet, form not
  submitted (`@negative @password`)
- Each required field (email/phone/password) left empty individually
  while the rest are valid — button stays disabled
  (`@negative @required-fields`)
- Registering again with an already used email does not succeed
  (`@negative @duplicate`)

Тесты помечены тегами Allure (`epic/feature/severity/owner`) для удобной
группировки в отчёте.
