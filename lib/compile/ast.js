'use strict';
const utils = require('../utils/utils');
const processor = require('./processor');
const blockNameRE = /(end)?(\w+)/;
let idIndex = 0;

class Ast {
  constructor(html, options = {}) {
    this.id = idIndex++;
    this.root = [];
    this.parent = null;
    this.blockStart = options.blockStart || '{%';
    this.blockEnd = options.blockEnd || '%}';
    this.variableStart = options.variableStart || '{{';
    this.variableEnd = options.variableEnd || '}}';
    this.commentStart = '{#';
    this.commentEnd = '#}';

    if (this.blockStart === this.variableStart) {
      throw new Error('blockStart should be different with variableStart!');
    }

    // create a regexp used to match leftStart
    this.startRegexp = utils.cache(
      `symbol_${this.blockStart}_${this.variableStart}_${this.commentStart}`,
      () => {
        // make sure can match the longest start string at first
        const str = [this.blockStart, this.variableStart, this.commentStart]
          .sort((a, b) => (a.length > b.length ? -1 : 1))
          .map(item => utils.reStringFormat(item))
          .join('|');
        return new RegExp(str);
      }
    );

    this.parse(html);
  }

  parse(str) {
    if (!str) {
      return;
    }

    let endIndex;
    let leftStart;
    let rightEnd;
    let isRaw;
    let element;
    let isBlock = false;
    let isComment = false;
    const root = this.root;
    const parent = this.parent;
    const collector = parent
      ? (parent.children = parent.children || [])
      : root;
    const matches = str.match(this.startRegexp);

    if (matches) {
      endIndex = matches.index;
      leftStart = matches[0];
      isBlock = leftStart === this.blockStart;
      isComment = leftStart === this.commentStart;
    } else {
      endIndex = str.length;
    }

    const chars = str.slice(0, endIndex);
    if (chars.length) {
      collectChars(collector, chars);
    }

    if (!matches) {
      // parse end
      return;
    }

    // get blockEnd or the other
    rightEnd = isBlock ? this.blockEnd : isComment ? this.commentEnd : this.variableEnd;
    str = str.slice(endIndex);

    // get rightEnd index
    endIndex = str.indexOf(rightEnd);
    let expression = str.slice(leftStart.length, endIndex);

    if (isComment) {
      // handle comment
      endIndex = endIndex >= 0 ? (endIndex + rightEnd.length) : str.length;
    } else if (endIndex < 0 || expression.indexOf(leftStart) >= 0) {
      // handle text
      collectChars(collector, leftStart);
      endIndex = leftStart.length;
    } else {
      // handle block or variable
      endIndex = endIndex + rightEnd.length;

      isRaw = parent && parent.raw;
      if (isBlock) {
        if (!isRaw) {
          const matches = expression.match(blockNameRE);
          const blockName = matches[0];
          const blockHandle = processor[blockName];

          if (blockHandle) {
            // create ast node
            element = blockHandle(
              { type: 1, parent },
              expression.slice(matches.index + blockName.length).trim(),
              this
            );
          }

          if (element) {
            element[blockName] = true;
            element.tag = blockName;

            if (!element.isUnary) {
              this.parent = element;
            }
          } else if (matches[1]) {
            this.closeTag(matches[2]);
          } else {
            throw new Error(`unknown block ${expression}`);
          }
        } else if (expression.trim() === 'endraw') {
          this.closeTag('raw');
        } else {
          collectChars(collector, leftStart + expression + rightEnd);
        }
      } else {
        if (isRaw) {
          collectChars(collector, leftStart + expression + rightEnd);
        } else {
          element = processor.variable({ type: 3 }, expression);
        }
      }

      if (element && !element.isAlone) {
        collector.push(element);
      }
    }

    this.parse(str.slice(endIndex));
  }

  // close block
  // change current parent
  closeTag(tagName) {
    const p = this.parent;
    // istanbul ignore else
    if (p) {
      this.parent = this.parent.parent;

      if (p.tag !== tagName) {
        return this.closeTag(tagName);
      } else {
        return p;
      }
    }
  }
}

function collectChars(collector, str) {
  const lastEl = collector[collector.length - 1];
  if (lastEl && lastEl.type === 2) {
    lastEl.text += str;
  } else {
    collector.push({
      text: str,
      type: 2,
    });
  }
}

module.exports = Ast;
