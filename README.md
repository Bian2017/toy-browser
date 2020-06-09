## 一、URL To HTML

## 二、HTML To DOM

## 三、DOM To DOM with CSS

实现 CSS Computing。

### 3.1 环境准备

#### 3.1.1 安装 `css` 包

> npm install css

```JS
var css = require('css');
var obj = css.parse('body { font-size: 12px; }', options);
css.stringify(obj, options);
```

- `css.parse` 接收 CSS 字符串，并返回 AST 对象;

### 3.1.2 收集 CSS 规则

## 四、DOM with CSS To DOM with position

实现 layout
