const net = require('net');
const parser = require('./parser.js');

/**
 * 定义 Request 对象
 *
 * 注：暂时只支持`application/json`、`application/x-www-form-urlencoded`两种格式
 */
class Request {
  constructor(options) {
    this.method = options.method || 'GET';
    this.host = options.host;
    this.port = options.port || 80;
    this.body = options.body || {};
    this.path = options.path || '/';
    this.headers = options.headers || {};

    if (!this.headers['Content-Type']) {
      this.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    // 根据Content-Type 进行相应编码
    if (this.headers['Content-Type'] === 'application/json') this.bodyText = JSON.stringify(this.body);
    else if (this.headers['Content-Type'] === 'application/x-www-form-urlencoded') {
      this.bodyText = Object.keys(this.body)
        .map((key) => `${key}=${encodeURIComponent(this.body[key])}`)
        .join('&');
    }

    this.headers['Content-Length'] = this.bodyText.length;
  }

  /**
   * HTTP本质上是一个文本协议。
   *
   * 注：request.body与request.header之间须有空行(\r\n)
   */
  toString() {
    return `${this.method} ${this.path} HTTP/1.1\r
${Object.keys(this.headers)
  .map((key) => `${key}: ${this.headers[key]}`)
  .join('\r\n')}\r
\r
${this.bodyText}`;
  }

  open(method, url) {}

  send(connection) {
    return new Promise((resolve, reject) => {
      // 处理接收回来的响应
      const parser = new ResponseParser();

      if (connection) {
        connection.write(this.toString());
      } else {
        connection = net.createConnection(
          {
            host: this.host,
            port: this.port,
          },
          () => {
            console.log('toString:', this.toString());
            connection.write(this.toString());
          }
        );
      }

      connection.on('data', (data) => {
        console.log('data:', data.toString());
        parser.receive(data.toString());

        if (parser.isFinished) {
          resolve(parser.response);
        }
        connection.end();
      });

      connection.on('error', (err) => {
        reject(err);
        connection.end();
      });
    });
  }
}

/**
 * TCP是一个流式数据，收到 on('data'）时，无法知道 data 是否是一个完整的 Response。
 * 所以需定义 ResponseParser 来负责产生完整的 Response。
 */
class ResponseParser {
  // 定义状态机
  constructor() {
    this.WAITING_STATUS_LINE = 0;
    this.WAITING_STATUS_LINE_END = 1; // 处理 \n
    this.WAITING_HEADER_NAME = 2;
    this.WAITING_HEADER_SPACE = 3;
    this.WAITING_HEADER_VALUE = 4;
    this.WAITING_HEADER_LINE_END = 5;

    this.WAITING_HEADER_BLOCK_END = 6; // 处理空白行

    this.WAITING_BODY = 7;

    // 当前状态
    this.current = this.WAITING_STATUS_LINE;

    this.statusLine = '';
    this.headers = {};
    this.headerName = '';
    this.headerValue = '';
    this.bodyParser = null;
  }

  // 有时需要允许访问返回动态计算值的属性，或者你可能需要反映内部变量的状态，而不需要使用显式方法调用。在JavaScript中，可以使用 getter 来实现。
  get isFinished() {
    return this.bodyParser && this.bodyParser.isFinished;
  }

  get response() {
    this.statusLine.match(/HTTP\/1.1 ([0-9]+) ([\s\S]+)/);

    return {
      statusCode: RegExp.$1,
      statusText: RegExp.$2,
      headers: this.headers,
      body: this.bodyParser.content.join(''),
    };
  }

  // 字符流处理
  receive(string) {
    for (let i = 0; i < string.length; i++) {
      this.receiveChar(string.charAt(i));
    }
  }

  receiveChar(char) {
    if (this.current === this.WAITING_STATUS_LINE) {
      if (char === '\r') {
        this.current = this.WAITING_STATUS_LINE_END;
      } else if (char === '\n') {
        this.current = this.WAITING_HEADER_NAME;
      } else {
        this.statusLine += char;
      }
    } else if (this.current === this.WAITING_STATUS_LINE_END) {
      if (char === '\n') {
        this.current = this.WAITING_HEADER_NAME;
      }
    } else if (this.current === this.WAITING_HEADER_NAME) {
      if (char === ':') {
        this.current = this.WAITING_HEADER_SPACE;
      } else if (char === '\r') {
        this.current = this.WAITING_HEADER_BLOCK_END;
      } else {
        this.headerName += char;
      }
    } else if (this.current === this.WAITING_HEADER_SPACE) {
      if (char === ' ') {
        this.current = this.WAITING_HEADER_VALUE;
      }
    } else if (this.current === this.WAITING_HEADER_VALUE) {
      // \r 作为分界符
      if (char === '\r') {
        this.current = this.WAITING_HEADER_LINE_END;
        // headers是有多行，遇到分界符即进行存储
        this.headers[this.headerName] = this.headerValue;
        this.headerName = '';
        this.headerValue = '';
      } else {
        this.headerValue += char;
      }
    } else if (this.current === this.WAITING_HEADER_LINE_END) {
      if (char === '\n') {
        this.current = this.WAITING_HEADER_NAME;
      }
    } else if (this.current === this.WAITING_HEADER_BLOCK_END) {
      if (char === '\n') {
        this.current = this.WAITING_BODY;
        if (this.headers['Transfer-Encoding'] === 'chunked') {
          this.bodyParser = new TrunkedBodyParser();
        }
      }
    } else if (this.current === this.WAITING_BODY) {
      this.bodyParser.receiveChar(char);
    }
  }
}

/**
 * body 通常会被拆成好几个trunk进行发送的
 */
class TrunkedBodyParser {
  // 定义Trunk状态机
  constructor() {
    this.WAITING_LENGTH = 0;
    this.WAITING_LENGTH_LINE_END = 1; // 遇到 \n 才会进入下一个状态
    // 已经知道TRUNK的大小，所以需计数器
    this.READING_TRUNK = 2;
    this.WAITING_NEW_LINE = 3;
    this.WAITING_NEW_LINE_END = 4;

    this.length = 0;
    this.isFinished = false;
    this.content = []; // 使用数组，没使用字符串，是因为字符串做加法的性能比较差
    this.current = this.WAITING_LENGTH;
  }

  // 字符处理
  receiveChar(char) {
    if (this.current === this.WAITING_LENGTH) {
      if (char === '\r') {
        if (this.length === 0) {
          this.isFinished = true;
        }
        this.current = this.WAITING_LENGTH_LINE_END;
      } else {
        this.length *= 16;
        this.length += parseInt(char, 16);

        // this.length *= 10;
        // this.length += char.charCodeAt(0) - '0'.charCodeAt(0);
      }
    } else if (this.current === this.WAITING_LENGTH_LINE_END) {
      if (char === '\n') {
        this.current = this.READING_TRUNK;
      }
    } else if (this.current === this.READING_TRUNK) {
      this.content.push(char);
      this.length--;

      if (this.length === 0) {
        this.current = this.WAITING_NEW_LINE;
      }
    } else if (this.current === this.WAITING_NEW_LINE) {
      if (char === '\r') {
        this.current = this.WAITING_NEW_LINE_END;
      }
    } else if (this.current === this.WAITING_NEW_LINE_END) {
      if (char === '\n') {
        // 每个trunk都是以空行来添加的
        this.current = this.WAITING_LENGTH;
      }
    }
  }
}

// IIFE
void (async function () {
  const request = new Request({
    method: 'POST',
    host: '192.168.0.163',
    port: '9090',
    path: '/',
    body: {
      name: 'Li',
    },
  });

  const response = await request.send();
  console.log('response:', response);

  const dom = parser.parseHTML(response.body);
})();
