# qpdf Lambda Layer

Este layer contiene qpdf para AWS Lambda.

## Uso

```javascript
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Usar qpdf
const { stdout } = await execAsync('/opt/bin/qpdf --version');
```

## Nota

Este es un placeholder. En producción, necesitas un binario real de qpdf compilado para Amazon Linux 2.
