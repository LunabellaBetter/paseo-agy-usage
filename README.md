# Paseo Antigravity Usage

Paseo plugin that shows your Antigravity CLI (`agy`) quotas in **Settings → Usage**.

![Antigravity usage card](./assets/marketplace/usage-dark.png)

## Install

```bash
paseo plugin add git:breathi3552/paseo-agy-usage
```

Requires Paseo >= 0.11.0 and a local `agy` login.

## How it works

Reads `agy` credentials from your OS keyring (Windows / macOS / Linux) and queries Google's quota API directly.

## Development

```bash
npm ci
npm test
paseo plugin install .
```

## License

[MIT](./LICENSE)
