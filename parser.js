const css = require('css');

let currentToken = null;
let currentAttribue = null;

// 创建一个栈: 采用document作为父节点。
let stack = [{ type: 'document', children: [] }];
let currentTextNode = null;

// 把CSS规则暂存到一个数组里
let rules = [];
function addCSSRules(text) {
  var ast = css.parse(text);
  rules.push(...ast.stylesheet.rules);
}

// 通过这个函数，将生成的token进行提交
function emit(token) {
  // 取栈顶
  let top = stack[stack.length - 1];

  if (token.type === 'startTag') {
    let element = {
      type: 'element',
      children: [],
      attributes: [],
    };

    element.tagName = token.tagName;

    for (let p in token) {
      if (p !== 'type' && p !== 'tagName') {
        element.attributes.push({
          name: p,
          value: token[p],
        });
      }
    }

    top.children.push(element);
    element.parent = top;

    if (!token.isSelfClosing) {
      stack.push(element);
    }

    currentTextNode = null;
  } else if (token.type == 'endTag') {
    if (top.tagName !== token.tagName) {
      throw new Error("Tag start end doesn't match!");
    } else {
      // +++++++++++++遇到style标签时，执行添加CSS规则的操作++++++++++++++
      if (top.tagName === 'style') {
        addCSSRules(top.children[0].content);
      }
      stack.pop();
    }
    currentTextNode = null;
  } else if (token.type == 'text') {
    if (currentTextNode == null) {
      currentTextNode = {
        type: 'text',
        content: '',
      };
      top.children.push(currentTextNode);
    }
    currentTextNode.content += token.content;
  }
}

/**
 * EOF: End Of File，通常在文本的最后存在此字符表示资料结束。
 * 为什么一定有一个EOF呢？因为很多文本结点的结束，可能是在文件结束的时候自然结束。在没有遇到一个特殊标签之前，就处于等待继续补齐字符串的状态。所以我们没有办法把最后这文本最后挂上去。
 *
 * 使用Symbol表示唯一，通过常量EOF将其它当做一个特殊的字符。在整个循环结束，再传给state，这样就实现了标识文件结尾的作用。
 * 通过这样的技巧，可以实现绝大多数带结束的场景。处理字符串其实也是需要结束的标志。
 */
const EOF = Symbol('EOF');

function data(c) {
  // 遇到字符 < 可能会有三种状态，即开始标签、结束标签或自封闭标签
  if (c === '<') {
    return tagOpen;
  } else if (c === EOF) {
    emit({
      type: 'EOF',
    });

    return;
  } else {
    emit({
      type: 'text',
      content: c,
    });
    return data;
  }
}

function tagOpen(c) {
  if (c === '/') {
    return endTagOpen;
  } else if (c.match(/^[a-zA-Z]$/)) {
    currentToken = {
      type: 'startTag',
      tagName: '',
    };
    // 见HTML标准中的Reconsume状态，其实就等同于tagName(c)
    return tagName(c);
  } else {
    emit({
      type: 'text',
      content: c,
    });
    return;
  }
}

function endTagOpen(c) {
  if (c.match(/^[a-zA-Z]$/)) {
    currentToken = {
      type: 'endTag',
      tagName: '',
    };
    return tagName(c);
  } else if (c === '>') {
  } else if (c === EOF) {
  } else {
  }
}

function tagName(c) {
  if (c.match(/^[\t\n\f ]$/)) {
    return beforeAttributeName;
  } else if (c === '/') {
    return selfClosingStartTag;
  } else if (c.match(/^[a-zA-Z]$/)) {
    currentToken.tagName += c; // .toLowerCase()  先不考虑大小写
    return tagName;
  } else if (c === '>') {
    emit(currentToken);
    return data;
  } else {
    currentToken.tagName += c;
    return tagName;
  }
}

// 开始处理属性
function beforeAttributeName(c) {
  if (c.match(/^[\t\n\f ]$/)) {
    return beforeAttributeName;
  } else if (c == '/' || c == '>' || c == EOF) {
    return afterAttributeName(c);
  } else if (c === '=') {
    // 此处应抛错
  } else {
    currentAttribue = {
      name: '',
      value: '',
    };

    return attributeName(c);
  }
}

function attributeName(c) {
  if (c.match(/^[\t\n\f ]$/) || c == '/' || c == '>' || c == EOF) {
    return afterAttributeName(c);
  } else if (c === '=') {
    return beforeAttributeValue;
  } else if (c === '\u0000') {
  } else if (c == '"' || c == "'" || c == '<') {
  } else {
    currentAttribue.name += c;
    return attributeName;
  }
}

function beforeAttributeValue(c) {
  if (c.match(/^[\t\n\f ]$/) || c == '/' || c == '>' || c == EOF) {
    return beforeAttributeValue;
  } else if (c == '"') {
    return doubleQuotedAttributeValue;
  } else if (c === "'") {
    return singleQuotedAttributeValue;
  } else if (c == '>') {
    // return data;
  } else {
    return UnquotedAttributeValue(c);
  }
}

function doubleQuotedAttributeValue(c) {
  if (c == '"') {
    currentToken[currentAttribue.name] = currentAttribue.value;
    return afterQuotedAttributeValue;
  } else if (c == '\u0000') {
  } else if (c === EOF) {
  } else {
    currentAttribue.value += c;
    return doubleQuotedAttributeValue;
  }
}

function singleQuotedAttributeValue(c) {
  if (c == "'") {
    currentToken[currentAttribue.name] = currentAttribue.value;
    return afterQuotedAttributeValue;
  } else if (c == '\u0000') {
  } else if (c === EOF) {
  } else {
    currentAttribue.value += c;
    return doubleQuotedAttributeValue;
  }
}

function afterQuotedAttributeValue(c) {
  if (c.match(/^[\t\n\f ]$/)) {
    return beforeAttributeName;
  } else if (c == '/') {
    return selfClosingStartTag;
  } else if (c == '>') {
    currentToken[currentAttribue.name] = currentAttribue.value;
    emit(currentToken);
    return data;
  } else if (c === EOF) {
  } else {
    currentAttribue.value += c;
    return doubleQuotedAttributeValue;
  }
}

function UnquotedAttributeValue(c) {
  if (c.match(/^[\t\n\f ]$/)) {
    currentToken[currentAttribue.name] = currentAttribue.value;
    return beforeAttributeName;
  } else if (c == '/') {
    currentToken[currentAttribue.name] = currentAttribue.value;
    return selfClosingStartTag;
  } else if (c == '>') {
    currentToken[currentAttribue.name] = currentAttribue.value;
    emit(currentToken);
    return data;
  } else if (c == '\u0000') {
  } else if (c == '"' || c == "'" || c == '<' || c == '=' || c == '`') {
  } else if (c === EOF) {
  } else {
    currentAttribue.value += c;
    return UnquotedAttributeValue;
  }
}

function selfClosingStartTag(c) {
  if (c === '>') {
    currentToken.isSelfClosing = true;
    emit(currentToken);
    return data;
  } else if (c === EOF) {
  } else {
  }
}

function afterAttributeName(c) {
  if (c.match(/^[\t\n\f ]$/)) {
    return afterAttributeName;
  } else if (c == '/') {
    return selfClosingStartTag;
  } else if (c == '=') {
    return beforeAttributeValue;
  } else if (c == '>') {
    currentToken[currentAttribue.name] = currentAttribue.value;
    emit(currentToken);
    return data;
  } else if (c === EOF) {
  } else {
    currentToken[currentAttribue.name] = currentAttribue.value;
    currentAttribue = {
      name: '',
      value: '',
    };
    return attributeName(c);
  }
}

module.exports.parseHTML = function parseHTML(html) {
  console.log('html:', html);
  let state = data;
  // 创建解析HTML的状态机

  for (let c of html) {
    state = state(c);
  }

  state = state(EOF);
  console.log(stack[0]);
};
