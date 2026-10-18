# Paseo Antigravity Usage

View Antigravity CLI (`agy`) quota remaining and reset times in Paseo.

![Antigravity usage card](./assets/marketplace/usage-dark.png)

## Install

```bash
paseo plugin add git:breathi3552/paseo-agy-usage
```

Requires Paseo >= 0.11.0 and a local `agy` login; Linux also requires `secret-tool` and an unlocked system keyring.

## Development

```bash
npm ci
npm test
paseo plugin install .
```

## License

[MIT](./LICENSE)
