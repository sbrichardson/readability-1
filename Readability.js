"use strict";

/*eslint-env es6:false*/

/*
 * Copyright (c) 2010 Arc90 Inc
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */



var LAZY_SRCSET_REG = /\.(jpg|jpeg|png|webp)\s+\d/,
  LAZY_SRC_REG = /^\s*\S+\.(jpg|jpeg|png|webp)\S*\s*$/,
  // Name is a single value
  META_NAME_REG = /^\s*(?:(dc|dcterm|og|twitter|weibo:(article|webpage))\s*[\.:]\s*)?(author|creator|description|title|site_name)\s*$/i,
  // Property is a space-separated list of values
  META_PROP_REG = /\s*(dc|dcterm|og|twitter)\s*:\s*(author|creator|description|title|site_name)\s*/gi;

function attemptsSortFn(a, b) {
  return b.textLength - a.textLength;
}

function isDataTableFn(o) {
  return !!o._readabilityDataTable;
}

function wordCount(str) {
  return str.split(/\s+/).length;
}

function toAbsoluteURI(doc, uri) {
  var baseURI = doc.baseURI; // Leave hash links alone if the base URI matches the document URI:

  if (baseURI == doc.documentURI && uri.charAt(0) == "#") return uri; // Otherwise, resolve against base URI:

  try {
    return new URL(uri, baseURI).href;
  } catch (ex) {
    // Something went wrong, just return the original:
  }

  return uri;
}

// TEMP Dev benchmarking

function clock(start) {
  if ( typeof start === 'undefined' ) return process.hrtime();
  var end = process.hrtime(start);
  return (end[0]*1000) + (end[1]/1000000);
}

function clockReport(arr) {
  return {
    n: arr.length,
    max: Math.max.apply(null, arr),
    min: Math.min.apply(null, arr),
    avg: arr.reduce(function(a, b) { return a + b }, 0) / arr.length
  }
}

/*
 * This code is heavily based on Arc90's readability.js (1.7.1) script
 * available at: http://code.google.com/p/arc90labs-readability
 */

/**
 * Public constructor.
 * @param {HTMLDocument} doc   The document to parse.
 * @param {Object}       opts  The options object.
 */

function Readability(doc, opts) {
  var t = this,
    logEl; // In some older versions, people passed a URI as the first argument. Cope:


  //
  // TEMP Dev Benchmarks
  //
  t.__clocks = {
    _initializeNode: [],
    _isPhrasingContent: [],
    _grabArticle: []
  };

  if (opts && opts.documentElement) {
    doc = opts;
    opts = arguments[2];
  } else if (!doc || !doc.documentElement)
    throw new Error(
      "First argument to Readability constructor should be a document object."
    );

  if (!opts) opts = {};
  t._doc = doc;
  t._attempts = [];
  t._docJSDOMParser = doc.firstChild.__JSDOMParser__;
  t._articleDir = t._articleTitle = t._articleByline = t._articleSiteName = null; // Configurable options

  t._debug = !!opts.debug;
  t._maxElemsToParse = opts.maxElemsToParse || t.DEFAULT_MAX_ELEMS_TO_PARSE;
  t._nbTopCandidates = opts.nbTopCandidates || t.DEFAULT_N_TOP_CANDIDATES;
  t._charThreshold = opts.charThreshold || t.DEFAULT_CHAR_THRESHOLD;
  t._keepClasses = !!opts.keepClasses;
  t._classesToPreserve = t.CLASSES_TO_PRESERVE.concat(
    opts.classesToPreserve || []
  ); // Start with all flags set

  t._flags =
    t.FLAG_STRIP_UNLIKELYS | t.FLAG_WEIGHT_CLASSES | t.FLAG_CLEAN_CONDITIONALLY; // Control whether log messages are sent to the console

  if (t._debug) {
    logEl = function logEl(e) {
      var rv = e.nodeName + " ";
      if (e.nodeType == e.TEXT_NODE) return rv + '("' + e.textContent + '")';
      var id = e.id,
        cN = e.className,
        classDesc,
        desc = "";
      if (cN) classDesc = "." + cN.replace(/ /g, ".");
      if (id) desc = "(#" + id + classDesc + ")";
      else if (classDesc) desc = "(" + classDesc + ")";
      return rv + desc;
    };

    t.log = function() {
      if (typeof dump !== "undefined") {
        var msg = Array.prototype.map
          .call(arguments, function(x) {
            if (x) return !!x.nodeName ? logEl(x) : x;
            return undefined;
          })
          .join(" ");
        dump("Reader: (Readability) " + msg + "\n");
      } else if (typeof console !== "undefined") {
        var args = ["Reader: (Readability) "],
          i = 0;

        for (; i < arguments.length; ++i) {
          args[args.length] = arguments[i];
        }

        console.log.apply(console, args);
      }
    };
  } else this.log = function() {};
}

Readability.prototype = {
  FLAG_STRIP_UNLIKELYS: 0x1,
  FLAG_WEIGHT_CLASSES: 0x2,
  FLAG_CLEAN_CONDITIONALLY: 0x4,
  // developer.mozilla.org/en-US/docs/Web/API/Node/nodeType
  ELEMENT_NODE: 1,
  TEXT_NODE: 3,
  // Max number of nodes supported by this parser. Default: 0 (no limit)
  DEFAULT_MAX_ELEMS_TO_PARSE: 0,
  // The number of top candidates to consider when analysing how
  // tight the competition is among candidates.
  DEFAULT_N_TOP_CANDIDATES: 5,
  // Element tags to score by default.
  DEFAULT_TAGS_TO_SCORE: [
    "SECTION",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "P",
    "TD",
    "PRE"
  ],
  // The default number of chars an article must have in order to return a result
  DEFAULT_CHAR_THRESHOLD: 500,
  // All of the regular expressions in use within readability.
  // Defined up here so we don't instantiate them repeatedly in loops.
  REGEXPS: {
    // NOTE: These two regular expressions are duplicated in
    // Readability-readerable.js. Please keep both copies in sync.
    unlikelyCandidates: /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote/i,
    okMaybeItsACandidate: /and|article|body|column|content|main|shadow/i,
    positive: /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i,
    negative: /hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|foot|footer|footnote|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget/i,
    extraneous: /print|archive|comment|discuss|e[\-]?mail|share|reply|all|login|sign|single|utility/i,
    byline: /byline|author|dateline|writtenby|p-author/i,
    replaceFonts: /<(\/?)font[^>]*>/gi,
    normalize: /\s{2,}/g,
    videos: /\/\/(www\.)?((dailymotion|youtube|youtube-nocookie|player\.vimeo|v\.qq)\.com|(archive|upload\.wikimedia)\.org|player\.twitch\.tv)/i,
    shareElements: /(\b|_)(share|sharedaddy)(\b|_)/i,
    nextLink: /(next|weiter|continue|>([^\|]|$)|»([^\|]|$))/i,
    prevLink: /(prev|earl|old|new|<|«)/i,
    whitespace: /^\s*$/,
    hasContent: /\S$/
  },
  DIV_TO_P_ELEMS: [
    "A",
    "BLOCKQUOTE",
    "DL",
    "DIV",
    "IMG",
    "OL",
    "P",
    "PRE",
    "TABLE",
    "UL",
    "SELECT"
  ],
  ALTER_TO_DIV_EXCEPTIONS: ["DIV", "ARTICLE", "SECTION", "P"],
  PRESENTATIONAL_ATTRIBUTES: [
    "align",
    "background",
    "bgcolor",
    "border",
    "cellpadding",
    "cellspacing",
    "frame",
    "hspace",
    "rules",
    "style",
    "valign",
    "vspace"
  ],
  DEPRECATED_SIZE_ATTRIBUTE_ELEMS: ["TABLE", "TH", "TD", "HR", "PRE"],
  // The commented out elements qualify as phrasing content but tend to be
  // removed by readability when put into paragraphs, so we ignore them here.
  PHRASING_ELEMS: [
    // "CANVAS", "IFRAME", "SVG", "VIDEO",
    "ABBR",
    "AUDIO",
    "B",
    "BDO",
    "BR",
    "BUTTON",
    "CITE",
    "CODE",
    "DATA",
    "DATALIST",
    "DFN",
    "EM",
    "EMBED",
    "I",
    "IMG",
    "INPUT",
    "KBD",
    "LABEL",
    "MARK",
    "MATH",
    "METER",
    "NOSCRIPT",
    "OBJECT",
    "OUTPUT",
    "PROGRESS",
    "Q",
    "RUBY",
    "SAMP",
    "SCRIPT",
    "SELECT",
    "SMALL",
    "SPAN",
    "STRONG",
    "SUB",
    "SUP",
    "TEXTAREA",
    "TIME",
    "VAR",
    "WBR"
  ],
  // These are the classes that readability sets itself.
  CLASSES_TO_PRESERVE: ["page"],

  /**
   * Run any post-process modifications to article content as necessary.
   *
   * @param Element
   * @return void
   **/
  _postProcessContent: function _postProcessContent(content) {
    // Readability cannot open relative uris so we convert them to absolute uris.
    this._fixRelativeUris(content); // Remove classes.

    !this._keepClasses && this._cleanClasses(content);
  },

  /**
   * Iterates over a NodeList, calls `filterFn` for each node and removes node
   * if function returned `true`.
   * If function is not passed, removes all the nodes in node list.
   *
   * @param NodeList nodeList The nodes to operate on
   * @param Function filterFn the function to use as a filter
   * @return void
   */
  _removeNodes: function _removeNodes(nodeList, filter) {
    // Avoid ever operating on live node lists.
    if (this._docJSDOMParser && nodeList._isLiveNodeList)
      throw new Error("Do not pass live node lists to _removeNodes");
    var i = nodeList.length,
      noFilter = typeof filter !== "function";

    for (; i > 0; ) {
      !!nodeList[--i].parentNode &&
        (noFilter || filter.call(this, nodeList[i], i, nodeList)) &&
        nodeList[i].parentNode.removeChild(nodeList[i]);
    }
  },

  /**
   * Iterates over a NodeList, and calls _setNodeTag for each node.
   * @param NodeList nodeList The nodes to operate on
   * @param String newTagName the new tag name to use
   * @return void
   */
  _replaceNodeTags: function _replaceNodeTags(nodeList, newTagName) {
    // Avoid ever operating on live node lists.
    if (this._docJSDOMParser && nodeList._isLiveNodeList)
      throw new Error("Do not pass live node lists to _replaceNodeTags");
    var i = nodeList.length;

    for (; i > 0; ) {
      this._setNodeTag(nodeList[--i], newTagName);
    }
  },

  /**
   * Iterate over a NodeList, which doesn't natively fully implement the Array
   * interface.
   * For convenience, the current object context is applied to the provided
   * iterate function.
   * @param  NodeList nodeList The NodeList.
   * @param  Function fn       The iterate function.
   * @return void
   */
  _forEachNode: function _forEachNode(nodeList, fn) {
    Array.prototype.forEach.call(nodeList, fn, this);
  },

  /**
   * Iterate over a NodeList, return true if any of the provided iterate
   * function calls returns true, false otherwise.
   * For convenience, the current object context is applied to the
   * provided iterate function.
   * @param  NodeList nodeList The NodeList.
   * @param  Function fn       The iterate function.
   * @return Boolean
   */
  _someNode: function _someNode(nodeList, fn) {
    return Array.prototype.some.call(nodeList, fn, this);
  },

  /**
   * Iterate over a NodeList, return true if all of the provided iterate
   * function calls return true, false otherwise.
   * For convenience, the current object context is applied to the
   * provided iterate function.
   * @param  NodeList nodeList The NodeList.
   * @param  Function fn       The iterate function.
   * @return Boolean
   */
  _everyNode: function _everyNode(nodeList, fn) {
    return Array.prototype.every.call(nodeList, fn, this);
  },

  /**
   * Concat all nodelists passed as arguments.
   * @return ...NodeList
   * @return Array
   */
  _concatNodeLists: function _concatNodeLists() {
    var args = [],
      n = arguments.length,
      i = 0; // REVIEW Remove map (combine with args loop)?
    // Change map to loop, remove extra concat?

    for (; i < n; ++i) {
      args[i] = arguments[i];
    }

    return Array.prototype.concat.apply(
      [],
      args.map(function(list) {
        return Array.prototype.slice.call(list);
      })
    );
  },
  _getAllNodesWithTag: function _getAllNodesWithTag(node, tagNames) {
    var collection; // REVIEW if extra concat needed etc.
    // Change map to for loop?

    return typeof node.querySelectorAll === "function"
      ? node.querySelectorAll(tagNames.join(","))
      : [].concat.apply(
          [],
          tagNames.map(function(tag) {
            return Array.isArray((collection = node.getElementsByTagName(tag)))
              ? collection
              : Array.from(collection);
          })
        );
  },

  /**
   * Removes the class="" attribute from every element in the given
   * subtree, except those that match CLASSES_TO_PRESERVE and
   * the classesToPreserve array from the options object.
   * @param Element
   * @return void
   */
  _cleanClasses: function _cleanClasses(o) {
    var t = this,
      c = "class",
      cN = o.getAttribute(c),
      // className
      classesToPreserve = t._classesToPreserve;

    if (cN) {
      (cN = cN
        .split(/\s+/)
        .filter(function(x) {
          return classesToPreserve.includes(x);
        })
        .join(" "))
        ? o.setAttribute(c, cN)
        : o.removeAttribute(c);
    } else o.removeAttribute(c);

    for (o = o.firstElementChild; !!o; o = o.nextElementSibling) {
      t._cleanClasses(o);
    }
  },

  /**
   * Converts each <a> and <img> uri in the given element to an absolute URI,
   * ignoring #ref URIs.
   * @param Element
   * @return void
   */
  _fixRelativeUris: function _fixRelativeUris(content) {
    var links = this._getAllNodesWithTag(content, ["a"]);

    this._forEachNode(links, function(link) {
      var href = link.getAttribute("href");
      if (!href) return; // Remove links with javascript: URIs, since they won't
      // work after scripts have been removed from the page.

      var t = this,
        doc = t._doc;

      if (href.indexOf("javascript:") === 0) {
        // If the link only contains simple text content,
        // it can be converted to a text node
        if (
          link.childNodes.length === 1 &&
          link.childNodes[0].nodeType === t.TEXT_NODE
        ) {
          var text = doc.createTextNode(link.textContent);
          link.parentNode.replaceChild(text, link);
        } else {
          // If the link has multiple children, they should all be preserved
          var container = doc.createElement("span");

          while (link.childNodes.length > 0) {
            container.appendChild(link.childNodes[0]);
          }

          link.parentNode.replaceChild(container, link);
        }
      } else link.setAttribute("href", toAbsoluteURI(doc, href));
    });

    var images = this._getAllNodesWithTag(content, ["img"]);

    this._forEachNode(images, function(img) {
      var src = img.getAttribute("src");
      !!src && img.setAttribute("src", toAbsoluteURI(this._doc, src));
    });
  },

  /**
   * Get the article title as an H1.
   * @return void
   **/
  _getArticleTitle: function _getArticleTitle() {
    var t = this,
      doc = t._doc,
      title = "",
      origTitle = "";

    try {
      title = origTitle = doc.title.trim(); // If they had an element with id "title" in their HTML

      if (typeof title !== "string")
        title = origTitle = t._getInnerText(
          doc.getElementsByTagName("title")[0]
        );
    } catch (err) {
      // Ignore exceptions setting the title
    }

    var titleHadHierarchicalSeparators = false; // If there's a separator in the title,
    // first remove the final part

    if (/ [\|\-\\\/>»] /.test(title)) {
      titleHadHierarchicalSeparators = / [\\\/>»] /.test(title);
      title = origTitle.replace(/(.*)[\|\-\\\/>»] .*/gi, "$1"); // If the resulting title is too short (3 words or fewer),
      // remove the first part instead:

      if (wordCount(title) < 3)
        title = origTitle.replace(/[^\|\-\\\/>»]*[\|\-\\\/>»](.*)/gi, "$1");
    } else if (title.includes(": ")) {
      // Check if we have an heading containing this exact string,
      // so we could assume it's the full title.
      var headings = t._concatNodeLists(
          doc.getElementsByTagName("h1"),
          doc.getElementsByTagName("h2")
        ),
        trimmedTitle = title.trim(),
        match = t._someNode(headings, function(heading) {
          return heading.textContent.trim() === trimmedTitle;
        }); // If we don't, let's extract the title out of the original
      // title string.

      if (!match) {
        title = origTitle.substring(origTitle.lastIndexOf(":") + 1); // If the title is now too short, try the first colon instead:
        // But if we have too many words before the colon there's
        // something weird with the titles and the H tags so let's
        // just use the original title instead

        if (wordCount(title) < 3)
          title = origTitle.substring(origTitle.indexOf(":") + 1);
        else if (wordCount(origTitle.substr(0, origTitle.indexOf(":"))) > 5)
          title = origTitle;
      }
    } else if (title.length > 150 || title.length < 15) {
      var hOnes = doc.getElementsByTagName("h1");
      if (hOnes.length === 1) title = t._getInnerText(hOnes[0]);
    }

    title = title.trim().replace(t.REGEXPS.normalize, " "); // If we now have 4 words or fewer as our title, and either no
    // 'hierarchical' separators (\, /, > or ») were found in the original
    // title or we decreased the number of words by more than 1 word, use
    // the original title.

    var titleWordCount = wordCount(title);
    if (
      titleWordCount <= 4 &&
      (!titleHadHierarchicalSeparators ||
        titleWordCount !=
          wordCount(origTitle.replace(/[\|\-\\\/>»]+/g, "")) - 1)
    )
      title = origTitle;
    return title;
  },

  /**
   * Prepare the HTML document for readability to scrape it.
   * This includes things like stripping javascript, CSS, and handling terrible markup.
   *
   * @return void
   **/
  _prepDocument: function _prepDocument() {
    var t = this,
      doc = t._doc; // Remove all style tags in head

    t._removeNodes(t._getAllNodesWithTag(doc, ["style"]));

    !!doc.body && t._replaceBrs(doc.body);

    t._replaceNodeTags(t._getAllNodesWithTag(doc, ["font"]), "SPAN");
  },

  /**
   * Finds the next element, starting from the given node, and ignoring
   * whitespace in between. If the given node is an element, the same node is
   * returned.
   */
  _nextElement: function _nextElement(node) {
    var next = node,
      whitespace = this.REGEXPS.whitespace;

    while (
      !!next &&
      next.nodeType != this.ELEMENT_NODE &&
      whitespace.test(next.textContent)
    ) {
      next = next.nextSibling;
    }

    return next;
  },

  /**
   * Replaces 2 or more successive <br> elements with a single <p>.
   * Whitespace between <br> elements are ignored. For example:
   *   <div>foo<br>bar<br> <br><br>abc</div>
   * will become:
   *   <div>foo<br>bar<p>abc</p></div>
   */
  _replaceBrs: function _replaceBrs(el) {
    this._forEachNode(this._getAllNodesWithTag(el, ["br"]), function(br) {
      // Whether 2 or more <br> elements have been found and replaced with a
      // <p> block.
      var t = this,
        next = br.nextSibling,
        replaced = false,
        brSibling; // If we find a <br> chain, remove the <br>s until we hit another element
      // or non-whitespace. This leaves behind the first <br> in the chain
      // (which will be replaced with a <p> later).

      while ((next = t._nextElement(next)) && next.tagName == "BR") {
        replaced = true;
        brSibling = next.nextSibling;
        next.parentNode.removeChild(next);
        next = brSibling;
      } // If we removed a <br> chain, replace the remaining <br> with a <p>. Add
      // all sibling nodes as children of the <p> until we hit another <br>
      // chain.

      if (replaced) {
        var nextEl,
          sibling,
          p = t._doc.createElement("p");

        br.parentNode.replaceChild(p, br);
        next = p.nextSibling;

        while (next) {
          // If we've hit another <br><br>, we're done adding children to this <p>.
          if (
            next.tagName == "BR" &&
            !!(nextEl = t._nextElement(next.nextSibling)) &&
            nextEl.tagName == "BR"
          )
            break;
          if (!t._isPhrasingContent(next)) break; // Otherwise, make this node a child of the new <p>.

          sibling = next.nextSibling;
          p.appendChild(next);
          next = sibling;
        }

        while (p.lastChild && t._isWhitespace(p.lastChild)) {
          p.removeChild(p.lastChild);
        }

        if (p.parentNode.tagName === "P") t._setNodeTag(p.parentNode, "DIV");
      }
    });
  },
  _setNodeTag: function _setNodeTag(node, tag) {
    this.log("_setNodeTag", node, tag);

    if (this._docJSDOMParser) {
      node.localName = tag.toLowerCase();
      node.tagName = tag.toUpperCase();
      return node;
    }

    var replacement = node.ownerDocument.createElement(tag);

    while (node.firstChild) {
      replacement.appendChild(node.firstChild);
    }

    node.parentNode.replaceChild(replacement, node);
    if (node.readability) replacement.readability = node.readability;
    var attrs = node.attributes,
      n = attrs.length,
      i = 0;

    for (; i < n; ++i) {
      try {
        replacement.setAttribute(attrs[i].name, attrs[i].value);
        continue;
      } catch (err) {
        /* it's possible for setAttribute() to throw if the attribute name
         * isn't a valid XML Name. Such attributes can however be parsed from
         * source in HTML docs, see github.com/whatwg/html/issues/4275,
         * so we can hit them here and then throw. We don't care about such
         * attributes so we ignore them.
         */
      }
    }

    return replacement;
  },

  /**
   * Prepare the article node for display. Clean out any inline styles,
   * iframes, forms, strip extraneous <p> tags, etc.
   * @param Element
   * @return void
   **/
  _prepArticle: function _prepArticle(content) {
    var t = this;

    t._cleanStyles(content); // Check for data tables before we continue, to avoid removing items in
    // those tables, which will often be isolated even though they're
    // visually linked to other content-ful elements (text, images, etc.).

    t._markDataTables(content);

    t._fixLazyImages(content); // Clean out junk from the article content

    t._cleanConditionally(content, "form");

    t._cleanConditionally(content, "fieldset");

    t._clean(content, "object");

    t._clean(content, "embed");

    t._clean(content, "h1");

    t._clean(content, "footer");

    t._clean(content, "link");

    t._clean(content, "aside"); // Clean out elements with little content that have "share" in their
    // id/class combinations from final top candidates, which means we
    // don't remove the top candidates even they have "share".

    var shareElThreshold = t.DEFAULT_CHAR_THRESHOLD,
      shareElReg = this.REGEXPS.shareElements;

    t._forEachNode(content.children, function(topCandidate) {
      this._cleanMatchedNodes(topCandidate, function(node, matchStr) {
        return (
          shareElReg.test(matchStr) &&
          node.textContent.length < shareElThreshold
        );
      });
    }); // If there is only one h2 and its text content substantially equals
    // article title, they are probably using it as a header and not a subheader,
    // so remove it since we already extract the title separately.

    var h2 = content.getElementsByTagName("h2");

    if (h2.length === 1) {
      var lengthSimilarRate =
        (h2[0].textContent.length - t._articleTitle.length) /
        t._articleTitle.length;

      if (Math.abs(lengthSimilarRate) < 0.5) {
        var titlesMatch =
          lengthSimilarRate > 0
            ? h2[0].textContent.includes(t._articleTitle)
            : t._articleTitle.includes(h2[0].textContent);
        titlesMatch && t._clean(content, "h2");
      }
    }

    t._clean(content, "iframe");

    t._clean(content, "input");

    t._clean(content, "textarea");

    t._clean(content, "select");

    t._clean(content, "button");

    t._cleanHeaders(content); // Do these last as the previous stuff may have removed junk
    // that will affect these

    t._cleanConditionally(content, "table");

    t._cleanConditionally(content, "ul");

    t._cleanConditionally(content, "div"); // Remove extra paragraphs

    t._removeNodes(t._getAllNodesWithTag(content, ["p"]), function(para) {
      var imgN = para.getElementsByTagName("img").length,
        embedN = para.getElementsByTagName("embed").length,
        objN = para.getElementsByTagName("object").length,
        // At this point, nasty iframes have been removed, only remain
        // embedded video ones.
        iframeN = para.getElementsByTagName("iframe").length,
        total = imgN + embedN + objN + iframeN;
      return total === 0 && !this._getInnerText(para, false);
    });

    t._forEachNode(t._getAllNodesWithTag(content, ["br"]), function(br) {
      var next = this._nextElement(br.nextSibling);

      !!next && next.tagName == "P" && br.parentNode.removeChild(br);
    }); // Remove single-cell tables

    t._forEachNode(t._getAllNodesWithTag(content, ["table"]), function(table) {
      var tbody = this._hasSingleTagInsideElement(table, "TBODY")
        ? table.firstElementChild
        : table;

      if (this._hasSingleTagInsideElement(tbody, "TR")) {
        var row = tbody.firstElementChild;

        if (this._hasSingleTagInsideElement(row, "TD")) {
          var cell = row.firstElementChild;
          cell = this._setNodeTag(
            cell,
            this._everyNode(cell.childNodes, this._isPhrasingContent)
              ? "P"
              : "DIV"
          );
          table.parentNode.replaceChild(cell, table);
        }
      }
    });
  },

  /**
   * Initialize a node with the readability object. Also checks the
   * className/id for special names to add to its score.
   *
   * @param Element
   * @return void
   **/
  _initializeNode: function _initializeNode(node) {
    var t1 = clock()
    var contentScore = 0;

    switch (node.tagName) {
      case "DIV":
        contentScore += 5;
        break;

      case "PRE":
      case "TD":
      case "BLOCKQUOTE":
        contentScore += 3;
        break;

      case "ADDRESS":
      case "OL":
      case "UL":
      case "DL":
      case "DD":
      case "DT":
      case "LI":
      case "FORM":
        contentScore -= 3;
        break;

      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6":
      case "TH":
        contentScore -= 5;
        break;
    }

    node.readability = {
      contentScore: contentScore
    };
    node.readability.contentScore += this._getClassWeight(node);

    var t2 = clock(t1)
    this.__clocks._initializeNode.push(t2)
  },
  _removeAndGetNext: function _removeAndGetNext(node) {
    var nextNode = this._getNextNode(node, true);

    node.parentNode.removeChild(node);
    return nextNode;
  },

  /**
   * Traverse the DOM from node to node, starting at the node passed in.
   * Pass true for the second parameter to indicate this node itself
   * (and its kids) are going away, and we want the next node over.
   *
   * Calling this in a loop will traverse the DOM depth-first.
   */
  _getNextNode: function _getNextNode(node, ignoreSelfAndKids) {
    // First check for kids if those aren't being ignored
    if (!ignoreSelfAndKids && !!node.firstElementChild)
      return node.firstElementChild; // Then for siblings...

    if (node.nextElementSibling) return node.nextElementSibling; // And finally, move up the parent chain *and* find a sibling
    // (because this is depth-first traversal, we will have already
    // seen the parent nodes themselves).

    do {
      node = node.parentNode;
    } while (node && !node.nextElementSibling);

    return !!node ? node.nextElementSibling : undefined;
  },
  _checkByline: function _checkByline(node, matchStr) {
    if (this._articleByline) return false;
    var t = this,
      rel,
      itemprop,
      bylineReg = t.REGEXPS.byline;

    if (typeof node.getAttribute === "function") {
      rel = node.getAttribute("rel");
      itemprop = node.getAttribute("itemprop");
    }

    if (
      (rel === "author" ||
        (itemprop && itemprop.includes("author")) ||
        bylineReg.test(matchStr)) &&
      t._isValidByline(node.textContent)
    ) {
      t._articleByline = node.textContent.trim();
      return true;
    }

    return false;
  },
  _getNodeAncestors: function _getNodeAncestors(node, maxDepth) {
    var hasMaxDepth = !!maxDepth,
      ancestors = [],
      i = 0;

    while (node.parentNode) {
      ancestors[ancestors.length] = node.parentNode;
      if (hasMaxDepth && ++i === maxDepth) return ancestors;
      node = node.parentNode;
    }

    return ancestors;
  },

  /***
   * grabArticle - Using a variety of metrics (content score, classname,
   * element types), find the content that is most likely to be the
   * stuff a user wants to read. Then return it wrapped up in a div.
   * @param page a document to run upon. Needs to be a full document, complete with body.
   * @return Element
   **/
  _grabArticle: function _grabArticle(page) {
    var t1 = clock()
    this.log("**** grabArticle ****");
    var t = this,
      doc = t._doc,
      regExps = t.REGEXPS,
      isPaging = page !== null ? true : false;
    page = !!page ? page : doc.body; // We can't grab an article if we don't have a page!

    if (!page) {
      t.log("No body found in document. Abort.");
      return null;
    }

    var pageCacheHtml = page.innerHTML;

    while (true) {
      var stripUnlikelyCandidates = t._flagIsActive(t.FLAG_STRIP_UNLIKELYS),
        // First, node prepping. Trash nodes that look cruddy (like ones with the
        // class name "comment", etc), and turn divs into P tags where they have been
        // used inappropriately (as in, where they contain no other block level elements.)
        elementsToScore = [],
        node = doc.documentElement,
        matchString;

      while (node) {
        matchString = node.className + " " + node.id;

        if (!t._isProbablyVisible(node)) {
          t.log("Removing hidden node - " + matchString);
          node = t._removeAndGetNext(node);
          continue;
        } // Check to see if this node is a byline, and remove it if it is.

        if (t._checkByline(node, matchString)) {
          node = t._removeAndGetNext(node);
          continue;
        } // Remove unlikely candidates

        if (stripUnlikelyCandidates)
          switch (node.tagName) {
            case "BODY":
            case "A":
              break;

            default:
              if (
                regExps.unlikelyCandidates.test(matchString) &&
                !regExps.okMaybeItsACandidate.test(matchString) &&
                !t._hasAncestorTag(node, "table")
              ) {
                t.log("Removing unlikely candidate - " + matchString);
                node = t._removeAndGetNext(node);
                continue;
              }

              break;
          } // Remove DIV, SECTION, and HEADER nodes without any
        // content(e.g. text, image, video, or iframe).
        // NOTE Changed to switch

        switch (node.tagName) {
          case "DIV":
          case "SECTION":
          case "HEADER":
          case "H1":
          case "H2":
          case "H3":
          case "H4":
          case "H5":
          case "H6":
            if (t._isElementWithoutContent(node)) {
              node = t._removeAndGetNext(node);
              continue;
            }

            break;

          default:
            break;
        }

        if (t.DEFAULT_TAGS_TO_SCORE.includes(node.tagName))
          elementsToScore[elementsToScore.length] = node; // Turn all divs that don't have children block level elements into p's

        if (node.tagName === "DIV") {
          // Put phrasing content into paragraphs.
          var p = null,
            childNode = node.firstChild,
            nextSibling;

          while (childNode) {
            nextSibling = childNode.nextSibling;

            if (t._isPhrasingContent(childNode)) {
              if (p !== null) p.appendChild(childNode);
              else if (!t._isWhitespace(childNode)) {
                p = doc.createElement("p");
                node.replaceChild(p, childNode);
                p.appendChild(childNode);
              }
            } else if (p !== null) {
              while (p.lastChild && t._isWhitespace(p.lastChild)) {
                p.removeChild(p.lastChild);
              }

              p = null;
            }

            childNode = nextSibling;
          } // Sites like http://mobile.slate.com encloses each paragraph with a DIV
          // element. DIVs with only a P element inside and no text content can be
          // safely converted into plain P elements to avoid confusing the scoring
          // algorithm with DIVs with are, in practice, paragraphs.

          if (
            t._hasSingleTagInsideElement(node, "P") &&
            t._getLinkDensity(node) < 0.25
          ) {
            var newNode = node.children[0];
            node.parentNode.replaceChild(newNode, node);
            node = newNode;
            elementsToScore[elementsToScore.length] = node;
          } else if (!t._hasChildBlockElement(node)) {
            node = t._setNodeTag(node, "P");
            elementsToScore[elementsToScore.length] = node;
          }
        }

        node = t._getNextNode(node);
      } // Loop through all paragraphs, and assign a score to them based on
      // how content-y they look.
      // Then add their score to their parent node.
      // A score is determined by things like number of commas, class names, etc.
      // Maybe eventually link density.

      var candidates = [];

      t._forEachNode(elementsToScore, function(elToScore) {
        if (
          !elToScore.parentNode ||
          typeof elToScore.parentNode.tagName === "undefined"
        )
          return; // If this paragraph is less than 25 characters, don't even count it.

        var innerText = t._getInnerText(elToScore);

        if (innerText.length < 25) return; // Exclude nodes with no ancestor.

        var ancestors = t._getNodeAncestors(elToScore, 3);

        if (ancestors.length === 0) return;
        var contentScore = 0; // Add a point for the paragraph itself as a base.

        contentScore += 1; // Add points for any commas within this paragraph.

        contentScore += innerText.split(",").length; // For every 100 characters in this paragraph, add another point. Up to 3 points.

        contentScore += Math.min(Math.floor(innerText.length / 100), 3); // Initialize and score ancestors.

        t._forEachNode(ancestors, function(ancestorNode, level) {
          if (
            !ancestorNode.tagName ||
            !ancestorNode.parentNode ||
            typeof ancestorNode.parentNode.tagName === "undefined"
          )
            return;

          if (typeof ancestorNode.readability === "undefined") {
            t._initializeNode(ancestorNode);

            candidates[candidates.length] = ancestorNode;
          } // Node score divider:
          // - parent:             1 (no division)
          // - grandparent:        2
          // - great grandparent+: ancestorNode level * 3

          var scoreDivider = level === 0 ? 1 : level === 1 ? 2 : level * 3;
          ancestorNode.readability.contentScore += contentScore / scoreDivider;
        });
      }); // After we've calculated scores, loop through all of the possible
      // candidate nodes we found and find the one with the highest score.

      for (
        var topCands = [], candidate, candScore, cl = candidates.length, c = 0;
        c < cl;
        ++c
      ) {
        candidate = candidates[c]; // Scale the final candidates score based on link density. Good content
        // should have a relatively small link density (5% or less) and be mostly
        // unaffected by this operation.

        candScore =
          candidate.readability.contentScore *
          (1 - t._getLinkDensity(candidate));
        candidate.readability.contentScore = candScore;
        t.log("Candidate:", candidate, "with score " + candScore);

        for (var tc = 0; tc < t._nbTopCandidates; ++tc) {
          var aTopCandidate = topCands[tc];

          if (
            !!aTopCandidate === false ||
            candScore > aTopCandidate.readability.contentScore
          ) {
            topCands.splice(tc, 0, candidate);
            topCands.length > t._nbTopCandidates && topCands.pop();
            break;
          }
        }
      }

      var topCandidate = topCands[0] || null,
        neededToCreateTopCandidate = false,
        parentOfTopCandidate; // If we still have no top candidate, just use the body as a last resort.
      // We also have to copy the body node so it is something we can modify.

      if (topCandidate === null || topCandidate.tagName === "BODY") {
        // Move all of the page's children into topCandidate
        topCandidate = doc.createElement("DIV");
        neededToCreateTopCandidate = true; // Move everything (not just elements, also text nodes etc.) into the container
        // so we even include text directly in the body:

        var kids = page.childNodes;

        while (kids.length) {
          t.log("Moving child out:", kids[0]);
          topCandidate.appendChild(kids[0]);
        }

        page.appendChild(topCandidate);

        t._initializeNode(topCandidate);
      } else if (topCandidate) {
        // Find a better top candidate node if it contains
        // (at least three) nodes which belong to `topCands` array
        // and whose scores are quite closed with current `topCandidate` node.
        var altCandAncestors = [],
          i = 1;

        for (; i < topCands.length; ++i) {
          if (
            topCands[i].readability.contentScore /
              topCandidate.readability.contentScore >=
            0.75
          )
            altCandAncestors[altCandAncestors.length] = t._getNodeAncestors(
              topCands[i]
            );
        }

        var MIN_TOPCAND = 3;

        if (altCandAncestors.length >= MIN_TOPCAND) {
          parentOfTopCandidate = topCandidate.parentNode;

          while (parentOfTopCandidate.tagName !== "BODY") {
            var listsContainingThisAncestor = 0;

            for (
              var ancestorIndex = 0;
              ancestorIndex < altCandAncestors.length &&
              listsContainingThisAncestor < MIN_TOPCAND;
              ++ancestorIndex
            ) {
              listsContainingThisAncestor += Number(
                altCandAncestors[ancestorIndex].includes(parentOfTopCandidate)
              );
            }

            if (listsContainingThisAncestor >= MIN_TOPCAND) {
              topCandidate = parentOfTopCandidate;
              break;
            }

            parentOfTopCandidate = parentOfTopCandidate.parentNode;
          }
        }

        !!topCandidate.readability === false && t._initializeNode(topCandidate); // Because of our bonus system, parents of candidates might have scores
        // themselves. They get half of the node. There won't be nodes with higher
        // scores than our topCandidate, but if we see the score going *up* in the first
        // few steps up the tree, that's a decent sign that there might be more content
        // lurking in other places that we want to unify in. The sibling stuff
        // below does some of that - but only if we've looked high enough up the DOM
        // tree.

        parentOfTopCandidate = topCandidate.parentNode;
        var lastScore = topCandidate.readability.contentScore,
          // The scores shouldn't get too low.
          scoreThreshold = lastScore / 3;

        while (parentOfTopCandidate.tagName !== "BODY") {
          if (!parentOfTopCandidate.readability) {
            parentOfTopCandidate = parentOfTopCandidate.parentNode;
            continue;
          }

          var parentScore = parentOfTopCandidate.readability.contentScore;
          if (parentScore < scoreThreshold) break;

          if (parentScore > lastScore) {
            // Alright! We found a better parent to use.
            topCandidate = parentOfTopCandidate;
            break;
          }

          lastScore = parentOfTopCandidate.readability.contentScore;
          parentOfTopCandidate = parentOfTopCandidate.parentNode;
        } // If the top candidate is the only child, use parent instead.
        // This will help sibling joining logic when adjacent content
        // is actually located in parent's sibling node.

        parentOfTopCandidate = topCandidate.parentNode;

        while (
          parentOfTopCandidate.tagName != "BODY" &&
          parentOfTopCandidate.children.length == 1
        ) {
          topCandidate = parentOfTopCandidate;
          parentOfTopCandidate = topCandidate.parentNode;
        }

        !!topCandidate.readability === false && t._initializeNode(topCandidate);
      } // Now that we have the top candidate, look through its siblings for content
      // that might also be related. Things like preambles, content split by ads
      // that we removed, etc.

      var articleContent = doc.createElement("DIV");
      if (isPaging) articleContent.id = "readability-content";
      var siblingScoreThreshold = Math.max(
        10,
        topCandidate.readability.contentScore * 0.2
      ); // Keep potential top candidate's parent node to try
      // to get text direction of it later.

      parentOfTopCandidate = topCandidate.parentNode;

      for (
        var siblings = parentOfTopCandidate.children,
          sl = siblings.length,
          s = 0;
        s < sl;
        ++s
      ) {
        var sibling = siblings[s],
          append = false;
        t.log(
          "Looking at sibling node:",
          sibling,
          sibling.readability
            ? "with score " + sibling.readability.contentScore
            : ""
        );
        t.log(
          "Sibling has score",
          sibling.readability ? sibling.readability.contentScore : "Unknown"
        );
        if (sibling === topCandidate) append = true;
        else {
          var contentBonus = 0; // Give a bonus if sibling nodes and top candidates have the example same classname

          if (
            sibling.className === topCandidate.className &&
            topCandidate.className !== ""
          )
            contentBonus += topCandidate.readability.contentScore * 0.2;
          if (
            !!sibling.readability &&
            sibling.readability.contentScore + contentBonus >=
              siblingScoreThreshold
          )
            append = true;
          else if (sibling.nodeName === "P") {
            var linkDensity = t._getLinkDensity(sibling),
              nodeContent = t._getInnerText(sibling),
              nodeLength = nodeContent.length;

            if (nodeLength > 80 && linkDensity < 0.25) append = true;
            else if (
              nodeLength < 80 &&
              nodeLength > 0 &&
              linkDensity === 0 &&
              nodeContent.search(/\.( |$)/) !== -1
            )
              append = true;
          }
        }

        if (append) {
          t.log("Appending node:", sibling);

          if (!t.ALTER_TO_DIV_EXCEPTIONS.includes(sibling.nodeName)) {
            // We have a node that isn't a common block level
            // element, like a form or td tag. Turn it into a div
            // so it doesn't get filtered out later by accident.
            t.log("Altering sibling:", sibling, "to div.");
            sibling = t._setNodeTag(sibling, "DIV");
          }

          articleContent.appendChild(sibling); // Siblings is a reference to the children array, and
          // sibling is removed from the array when we call appendChild().
          // As a result, we must revisit this index since the nodes
          // have been shifted.

          s -= 1;
          sl -= 1;
        }
      } // So we have all of the content that we need. Now we
      // clean it up for presentation.

      switch (!!t._debug) {
        case false:
          t._prepArticle(articleContent);

          break;

        case true:
          t.log("Article content pre-prep: " + articleContent.innerHTML);

          t._prepArticle(articleContent);

          t.log("Article content post-prep: " + articleContent.innerHTML);
          break;
      }

      if (neededToCreateTopCandidate) {
        // We already created a fake div thing, and there wouldn't
        // have been any siblings left for the previous loop, so
        // there's no point trying to create a new div, and then
        // move all the children over. Just assign IDs and class
        // names here. No need to append because that already
        // happened anyway.
        topCandidate.id = "readability-page-1";
        topCandidate.className = "page";
      } else {
        var div = doc.createElement("DIV");
        div.id = "readability-page-1";
        div.className = "page";
        var children = articleContent.childNodes;

        while (children.length) {
          div.appendChild(children[0]);
        }

        articleContent.appendChild(div);
      }

      t._debug &&
        t.log("Article content after paging: " + articleContent.innerHTML); // Now that we've gone through the full algorithm, check
      // to see if we got any meaningful content. If we didn't,
      // we may need to re-run grabArticle with different flags set.
      // This gives us a higher likelihood of finding the content,
      // and the sieve approach gives us a higher likelihood of
      // finding the -right- content.

      var textLength = t._getInnerText(articleContent, true).length;

      if (textLength < t._charThreshold) {
        page.innerHTML = pageCacheHtml;
        var attempts = t._attempts;
        attempts[attempts.length] = {
          articleContent: articleContent,
          textLength: textLength
        };

        if (t._flagIsActive(t.FLAG_STRIP_UNLIKELYS)) {
          t._removeFlag(t.FLAG_STRIP_UNLIKELYS);

          continue;
        }

        if (t._flagIsActive(t.FLAG_WEIGHT_CLASSES)) {
          t._removeFlag(t.FLAG_WEIGHT_CLASSES);

          continue;
        }

        if (t._flagIsActive(t.FLAG_CLEAN_CONDITIONALLY)) {
          t._removeFlag(t.FLAG_CLEAN_CONDITIONALLY);

          continue;
        } // No luck after removing flags, just return the longest
        // text we found during the different loops

        attempts.sort(attemptsSortFn); // But first check if we actually have something

        if (!attempts[0].textLength) return null;
        articleContent = attempts[0].articleContent;
      } // Find out text direction from ancestors of final top candidate.

      t._someNode(
        [parentOfTopCandidate, topCandidate].concat(
          t._getNodeAncestors(parentOfTopCandidate)
        ),
        function(ancestorNode) {
          var articleDir;

          if (
            !!ancestorNode.tagName &&
            !!(articleDir = ancestorNode.getAttribute("dir"))
          ) {
            this._articleDir = articleDir;
            return true;
          }

          return false;
        }
      );

      var t2 = clock(t1)
      t.__clocks._grabArticle.push(t2)

      return articleContent;
    }
  },

  /**
   * Check whether the input string could be a byline.
   * This verifies that the input is a string, and that the length
   * is less than 100 chars.
   *
   * @param possibleByline {string} - a string to check whether its a byline.
   * @return Boolean - whether the input string is a byline.
   */
  _isValidByline: function _isValidByline(byline) {
    return typeof byline == "string"
      ? (byline = byline.trim()).length > 0 && byline.length < 100
      : false;
  },

  /**
   * Attempts to get excerpt and byline metadata for the article.
   *
   * @return Object with optional "excerpt" and "byline" properties
   */
  _getArticleMetadata: function _getArticleMetadata() {
    var o = {},
      meta = {},
      metaEls = this._doc.getElementsByTagName("meta"); // Find description tags.

    this._forEachNode(metaEls, function(el) {
      var content = el.getAttribute("content");
      if (!content) return;
      var name,
        matches,
        elProp = el.getAttribute("property"); // Convert to lowercase, and remove any whitespace
      // so we can match below.
      // Multiple authors

      if (elProp && (matches = elProp.match(META_PROP_REG)))
        for (var i = matches.length; i > 0; ) {
          o[matches[--i].toLowerCase().replace(/\s/g, "")] = content.trim();
        } // Convert to lowercase, remove any whitespace, and convert dots
      // to colons so we can match below.

      if (
        content &&
        !matches &&
        (name = el.getAttribute("name")) &&
        META_NAME_REG.test(name)
      )
        o[
          name
            .toLowerCase()
            .replace(/\s/g, "")
            .replace(/\./g, ":")
        ] = content.trim();
    }); // Get title

    meta.title =
      o["dc:title"] ||
      o["dcterm:title"] ||
      o["og:title"] ||
      o["weibo:article:title"] ||
      o["weibo:webpage:title"] ||
      o.title ||
      o["twitter:title"] ||
      this._getArticleTitle(); // Get author

    meta.byline = o["dc:creator"] || o["dcterm:creator"] || o.author; // Get description

    meta.excerpt =
      o["dc:description"] ||
      o["dcterm:description"] ||
      o["og:description"] ||
      o["weibo:article:description"] ||
      o["weibo:webpage:description"] ||
      o.description ||
      o["twitter:description"]; // Get site name

    meta.siteName = o["og:site_name"];
    return meta;
  },

  /**
   * Removes script tags from the document.
   *
   * @param Element
   **/
  _removeScripts: function _removeScripts(doc) {
    this._removeNodes(this._getAllNodesWithTag(doc, ["script"]), function(
      scriptNode
    ) {
      scriptNode.nodeValue = "";
      scriptNode.removeAttribute("src");
      return true;
    });

    this._removeNodes(this._getAllNodesWithTag(doc, ["noscript"]));
  },

  /**
   * Check if this node has only whitespace and a single element with given tag
   * Returns false if the DIV node contains non-empty text nodes
   * or if it contains no element with given tag or more than 1 element.
   *
   * @param Element
   * @param string tag of child element
   **/
  _hasSingleTagInsideElement: function _hasSingleTagInsideElement(el, tag) {
    // There should be exactly 1 el child with given tag
    if (el.children.length != 1 || el.children[0].tagName !== tag) return false; // And there should be no text nodes with real content

    return !this._someNode(el.childNodes, function(node) {
      return (
        node.nodeType === this.TEXT_NODE &&
        this.REGEXPS.hasContent.test(node.textContent)
      );
    });
  },
  _isElementWithoutContent: function _isElementWithoutContent(node) {
    if (
      node.nodeType === this.ELEMENT_NODE &&
      node.textContent.trim().length == 0
    ) {
      var childrenLen = node.children.length;
      return (
        childrenLen == 0 ||
        childrenLen ==
          node.getElementsByTagName("br").length +
            node.getElementsByTagName("hr").length
      );
    }

    return false;
  },

  /**
   * Determine whether element has any children block level elements.
   * @param Element
   */
  _hasChildBlockElement: function _hasChildBlockElement(element) {
    return this._someNode(element.childNodes, function(node) {
      return (
        this.DIV_TO_P_ELEMS.includes(node.tagName) ||
        this._hasChildBlockElement(node)
      );
    });
  },

  /***
   * Determine if a node qualifies as phrasing content.
   * developer.mozilla.org/en-US/docs/Web/Guide/HTML/Content_categories#Phrasing_content
   **/
  _isPhrasingContent: function _isPhrasingContent(node) {
    var t1 = clock()
    var t = this,
      tagName = node.tagName,
      res;

    if (node.nodeType === t.TEXT_NODE) res = true
    else
      switch(tagName) {
        // "CANVAS", "IFRAME", "SVG", "VIDEO",
        case "ABBR":
        case "AUDIO":
        case "B":
        case "BDO":
        case "BR":
        case "BUTTON":
        case "CITE":
        case "CODE":
        case "DATA":
        case "DATALIST":
        case "DFN":
        case "EM":
        case "EMBED":
        case "I":
        case "IMG":
        case "INPUT":
        case "KBD":
        case "LABEL":
        case "MARK":
        case "MATH":
        case "METER":
        case "NOSCRIPT":
        case "OBJECT":
        case "OUTPUT":
        case "PROGRESS":
        case "Q":
        case "RUBY":
        case "SAMP":
        case "SCRIPT":
        case "SELECT":
        case "SMALL":
        case "SPAN":
        case "STRONG":
        case "SUB":
        case "SUP":
        case "TEXTAREA":
        case "TIME":
        case "VAR":
        case "WBR":
          res = true;
          break;
        case "A":
        case "DEL":
        case "INS":
          res = t._everyNode(node.childNodes, t._isPhrasingContent);
          break;
        default:
          res = false;
          break;
      }

    // if (node.nodeType === t.TEXT_NODE || t.PHRASING_ELEMS.includes(tagName))
    //   res = true;
    // else
    //   switch (tagName) {
    //     case "A":
    //     case "DEL":
    //     case "INS":
    //       res = t._everyNode(node.childNodes, t._isPhrasingContent);
    //       break;
    //     default:
    //       res = false;
    //       break;
    //   }

    var t2 = clock(t1)
    t.__clocks._isPhrasingContent.push(t2)

    return res
  },
  _isWhitespace: function _isWhitespace(node) {
    var text = this.TEXT_NODE,
      el = this.ELEMENT_NODE;

    switch (node.nodeType) {
      case text:
        return node.textContent.trim().length === 0;

      case el:
        return node.tagName === "BR";

      default:
        return false;
    }
  },

  /**
   * Get the inner text of a node - cross browser compatibly.
   * This also strips out any excess whitespace to be found.
   * @param Element
   * @param Boolean normalizeSpaces (default: true)
   * @return string
   **/
  _getInnerText: function _getInnerText(e, normalizeSpaces) {
    normalizeSpaces =
      typeof normalizeSpaces === "undefined" ? true : normalizeSpaces;
    var textContent = e.textContent.trim();
    return normalizeSpaces
      ? textContent.replace(this.REGEXPS.normalize, " ")
      : textContent;
  },

  /**
   * Get the number of times a string s appears in the node e.
   * @param Element
   * @param string - what to split on. Default is ","
   * @return number (integer)
   **/
  _getCharCount: function _getCharCount(e, s) {
    if (!s) s = ",";
    return this._getInnerText(e).split(s).length - 1;
  },

  /**
   * Remove the style attribute on every e and under.
   * TODO: Test if getElementsByTagName(*) is faster.
   * @param Element
   * @return void
   **/
  _cleanStyles: function _cleanStyles(e) {
    if (!e) return;
    if (e.tagName.toLowerCase() === "svg") return; // Remove `style` and deprecated presentational attributes

    for (var i = 0; i < this.PRESENTATIONAL_ATTRIBUTES.length; ++i) {
      e.removeAttribute(this.PRESENTATIONAL_ATTRIBUTES[i]);
    }

    if (this.DEPRECATED_SIZE_ATTRIBUTE_ELEMS.includes(e.tagName)) {
      e.removeAttribute("width");
      e.removeAttribute("height");
    }

    var curr = e.firstElementChild;

    while (curr !== null) {
      this._cleanStyles(curr);

      curr = curr.nextElementSibling;
    }
  },

  /**
   * Get the density of links as a percentage of the content
   * This is the amount of text that is inside a link divided by the total text in the node.
   * @param Element
   * @return number (float)
   **/
  _getLinkDensity: function _getLinkDensity(el) {
    var textLength = this._getInnerText(el).length;

    if (textLength === 0) return 0;
    var linkLength = 0; // XXX implement _reduceNodeList?

    this._forEachNode(el.getElementsByTagName("a"), function(linkNode) {
      linkLength += this._getInnerText(linkNode).length;
    });

    return linkLength / textLength;
  },

  /**
   * Get an elements class/id weight. Uses regular expressions to tell if this
   * element looks good or bad.
   * @param Element
   * @return number (Integer)
   **/
  _getClassWeight: function _getClassWeight(e) {
    if (!this._flagIsActive(this.FLAG_WEIGHT_CLASSES)) return 0;
    var id = e.id,
      weight = 0,
      cN = e.className,
      regExps = this.REGEXPS,
      neg = regExps.negative,
      pos = regExps.positive; // Look for a special classname

    if (typeof cN === "string" && cN !== "") {
      if (neg.test(cN)) weight -= 25;
      if (pos.test(cN)) weight += 25;
    } // Look for a special ID

    if (typeof id === "string" && id !== "") {
      if (neg.test(id)) weight -= 25;
      if (pos.test(id)) weight += 25;
    }

    return weight;
  },

  /**
   * Clean a node of all elements of type "tag".
   * (Unless it's a youtube/vimeo video. People love movies.)
   *
   * @param Element
   * @param string tag to clean
   * @return void
   **/
  _clean: function _clean(e, tag) {
    var isEmbed = false,
      vidRegex = this.REGEXPS.videos;

    switch (tag) {
      case "object":
      case "embed":
      case "iframe":
        isEmbed = true;
        break;

      default:
        break;
    }

    this._removeNodes(this._getAllNodesWithTag(e, [tag]), function(el) {
      // Allow youtube and vimeo videos through as people usually want to see those.
      if (isEmbed) {
        // First, check the elements attributes to see if any of them contain youtube or vimeo
        for (var i = 0; i < el.attributes.length; i++) {
          if (vidRegex.test(el.attributes[i].value)) return false;
        } // For embed with <object> tag, check inner HTML as well.

        if (el.tagName === "object" && vidRegex.test(el.innerHTML))
          return false;
      }

      return true;
    });
  },

  /**
   * Check if a given node has one of its ancestor tag name matching the
   * provided one.
   * @param  HTMLElement node
   * @param  String      tagName
   * @param  Number      maxDepth
   * @param  Function    filterFn a filter to invoke to determine whether this node 'counts'
   * @return Boolean
   */
  _hasAncestorTag: function _hasAncestorTag(node, tagName, maxDepth, filterFn) {
    tagName = tagName.toUpperCase();
    if (!maxDepth) maxDepth = 3;
    var depth = 0,
      noFilter = typeof filterFn !== "function",
      hasMaxDepth = maxDepth > 0;

    while (node.parentNode) {
      if (hasMaxDepth && depth > maxDepth) return false;
      if (
        node.parentNode.tagName === tagName &&
        (noFilter || filterFn(node.parentNode))
      )
        return true;
      node = node.parentNode;
      ++depth;
    }

    return false;
  },

  /**
   * Return an object indicating how many rows and columns this table has.
   */
  _getRowAndColumnCount: function _getRowAndColumnCount(table) {
    var rows = 0,
      columns = 0,
      trs = table.getElementsByTagName("tr"),
      trsLen = trs.length,
      i = 0,
      j,
      cells,
      cellLen,
      rowspan,
      colspan,
      colsInRow;

    for (; i < trsLen; ++i) {
      rows += !!(rowspan = trs[i].getAttribute("rowspan"))
        ? !!(rowspan = parseInt(rowspan, 10))
          ? rowspan
          : 1
        : 1; // Now look for column-related info

      for (
        j = colsInRow = 0,
          cellLen = (cells = trs[i].getElementsByTagName("td")).length;
        j < cellLen;
        ++j
      ) {
        colsInRow += !!(colspan = cells[j].getAttribute("colspan"))
          ? !!(colspan = parseInt(colspan, 10))
            ? colspan
            : 1
          : 1;
      }

      columns = Math.max(columns, colsInRow);
    }

    return {
      rows: rows,
      columns: columns
    };
  },

  /**
   * Look for 'data' (as opposed to 'layout') tables, for which we use
   * similar checks as
   * https://dxr.mozilla.org/mozilla-central/rev/71224049c0b52ab190564d3ea0eab089a159a4cf/accessible/html/HTMLTableAccessible.cpp#920
   */
  _markDataTables: function _markDataTables(root) {
    var tables = root.getElementsByTagName("table"),
      n = tables.length,
      i = 0,
      caption,
      table,
      rows,
      cols,
      sz,
      getRowAndColumnCount = this._getRowAndColumnCount;

    for (; i < n; ++i) {
      if (
        (table = tables[i]).getAttribute("role") == "presentation" ||
        table.getAttribute("datatable") == "0"
      ) {
        table._readabilityDataTable = false;
        continue;
      }

      if (
        !!table.getAttribute("summary") ||
        ((caption = table.getElementsByTagName("caption")[0]) &&
          caption.childNodes.length > 0)
      ) {
        table._readabilityDataTable = true;
        continue;
      } // If the table has a descendant with any of these tags,
      // consider using a data table.
      // TODO Optimize with for loop?

      if (
        ["col", "colgroup", "tfoot", "thead", "th"].some(function(tag) {
          return !!table.getElementsByTagName(tag)[0];
        })
      ) {
        this.log("Data table because found data-y descendant");
        table._readabilityDataTable = true;
        continue;
      } // Nested tables indicate a layout table:

      if (table.getElementsByTagName("table")[0]) {
        table._readabilityDataTable = false;
        continue;
      }

      rows = (sz = getRowAndColumnCount(table)).rows;
      cols = sz.cols;

      if (rows >= 10 || cols > 4) {
        table._readabilityDataTable = true;
        continue;
      } // Now just go by size entirely:

      table._readabilityDataTable = rows * cols > 10;
    }
  },

  /* convert images and figures that have properties like data-src into images that can be loaded without JS */
  _fixLazyImages: function _fixLazyImages(root) {
    this._forEachNode(
      this._getAllNodesWithTag(root, ["img", "picture", "figure"]),
      function(el) {
        // Check for "null" to workaround github.com/jsdom/jsdom/issues/2580
        var srcset,
          valid =
            (!el.src && ((srcset = el.srcset) == "null" || !srcset)) ||
            el.className.toLowerCase().includes("lazy");
        if (!valid) return;
        var t = this,
          doc = t._doc,
          tagName = el.tagName,
          attrs = el.attributes,
          n = attrs.length,
          i = 0,
          copyTo,
          img,
          x,
          figTags = ["img", "picture"];

        for (; i < n; ++i) {
          switch (attrs[i].name) {
            case "src":
            case "srcset":
              continue;

            default:
              if (LAZY_SRCSET_REG.test((x = attrs[i].value))) copyTo = "srcset";
              else if (LAZY_SRC_REG.test(x)) copyTo = "src";
              else continue;

              switch (tagName) {
                case "IMG":
                case "PICTURE":
                  el.setAttribute(copyTo, x);
                  continue;

                case "FIGURE":
                  // If the item is a <figure> that does not contain an image or
                  // picture, create one and place it inside the figure
                  // See the nytimes-3 testcase for an example
                  if (t._getAllNodesWithTag(el, figTags).length > 0) continue;
                  (img = doc.createElement("img")).setAttribute(copyTo, x);
                  el.appendChild(img);
                  continue;

                default:
                  continue;
              }
          }
        }
      }
    );
  },

  /**
   * Clean an element of all tags of type "tag" if they look fishy.
   * "Fishy" is an algorithm based on content length, classnames, link density, number of images & embeds, etc.
   *
   * @return void
   **/
  _cleanConditionally: function _cleanConditionally(e, tag) {
    if (!this._flagIsActive(this.FLAG_CLEAN_CONDITIONALLY)) return;
    var isList = false;

    switch (tag) {
      case "ul":
      case "ol":
        isList = true;
        break;

      default:
        break;
    } // Gather counts for other typical elements embedded within.
    // Traverse backwards so we can remove nodes at the same time
    // without effecting the traversal.
    // TODO Consider taking into account original contentScore here.

    this._removeNodes(this._getAllNodesWithTag(e, [tag]), function(node) {
      // First check if this node IS data table, in which case don't remove it.
      // Next check if we're inside a data table, in which case don't remove it as well.
      if (
        (tag === "table" && isDataTableFn(node)) ||
        this._hasAncestorTag(node, "table", -1, isDataTableFn)
      )
        return false;

      var t = this,
        contentScore = 0,
        weight = t._getClassWeight(node);

      t.log("Cleaning Conditionally", node);
      if (weight + contentScore < 0) return true;

      if (t._getCharCount(node, ",") < 10) {
        // If there are not very many commas, and the number of
        // non-paragraph elements is more than paragraphs or other
        // ominous signs, remove the element.
        var p = node.getElementsByTagName("p").length,
          img = node.getElementsByTagName("img").length,
          li = node.getElementsByTagName("li").length - 100,
          input = node.getElementsByTagName("input").length,
          embeds = t._getAllNodesWithTag(node, ["object", "embed", "iframe"]),
          vidRegex = t.REGEXPS.videos,
          // embedsLen = embeds.length, // TEMP Disabled
          embedCount = 0,
          attrsLen,
          attrs,
          embed,
          i = 0,
          j;

        for (; i < embeds.length; ++i) {
          attrs = (embed = embeds[i]).attributes;
          attrsLen = attrs.length; // If this embed has attribute that matches video regex, don't delete it.

          for (j = 0; j < attrsLen; ++j) {
            if (vidRegex.test(attrs[j].value)) return false;
          } // For embed with <object> tag, check inner HTML as well.

          if (embed.tagName === "object" && vidRegex.test(embed.innerHTML))
            return false;
          ++embedCount;
        }

        var linkDensity = t._getLinkDensity(node),
          contentLength = t._getInnerText(node).length,
          haveToRemove =
            (img > 1 && p / img < 0.5 && !t._hasAncestorTag(node, "figure")) ||
            (!isList && li > p) ||
            input > Math.floor(p / 3) ||
            (!isList &&
              contentLength < 25 &&
              (img === 0 || img > 2) &&
              !this._hasAncestorTag(node, "figure")) ||
            (!isList && weight < 25 && linkDensity > 0.2) ||
            (weight >= 25 && linkDensity > 0.5) ||
            (embedCount === 1 && contentLength < 75) ||
            embedCount > 1;

        return haveToRemove;
      }

      return false;
    });
  },

  /**
   * Clean out elements that match the specified conditions
   * @param Element
   * @param Function determines whether a node should be removed
   * @return void
   **/
  _cleanMatchedNodes: function _cleanMatchedNodes(e, filter) {
    var t = this,
      endOfSearchMarkerNode = t._getNextNode(e, true),
      next = t._getNextNode(e);

    while (next && next != endOfSearchMarkerNode) {
      next = filter.call(t, next, next.className + " " + next.id)
        ? t._removeAndGetNext(next)
        : t._getNextNode(next);
    }
  },

  /**
   * Clean out spurious headers from an Element. Checks things
   * like classnames and link density.
   * @param Element
   * @return void
   **/
  _cleanHeaders: function _cleanHeaders(e) {
    this._removeNodes(this._getAllNodesWithTag(e, ["h1", "h2"]), function(
      header
    ) {
      return this._getClassWeight(header) < 0;
    });
  },
  _flagIsActive: function _flagIsActive(flag) {
    return (this._flags & flag) > 0;
  },
  _removeFlag: function _removeFlag(flag) {
    this._flags = this._flags & ~flag;
  },
  _isProbablyVisible: function _isProbablyVisible(node) {
    var sty = node.style,
      cN; // Have to null-check node.style and node.className.indexOf
    // to deal with SVG and MathML nodes.

    return (
      (!sty || sty.display != "none") &&
      !node.hasAttribute("hidden") && //check for "fallback-image" so that wikimedia math images are displayed
      (!node.hasAttribute("aria-hidden") ||
        node.getAttribute("aria-hidden") != "true" ||
        ((cN = node.className) &&
          cN.indexOf &&
          cN.indexOf("fallback-image") !== -1))
    );
  },

  /**
   * Runs readability.
   * Workflow:
   *  1. Prep the document by removing script tags, css, etc.
   *  2. Build readability's DOM tree.
   *  3. Grab the article content from the current dom tree.
   *  4. Replace the current DOM tree with the new one.
   *  5. Read peacefully.
   *
   * @return void
   **/
  parse: function parse() {
    var t = this,
      c,
      text,
      meta,
      title,
      byline,
      excerpt,
      siteName,
      paragraphs,
      doc = t._doc,
      maxEls = t._maxElemsToParse,
      numEls; // Avoid parsing too large documents, as per config

    if (maxEls > 0 && (numEls = doc.getElementsByTagName("*").length) > maxEls)
      throw new Error(
        "Aborting parsing document; "
          .concat(numEls, " elements found > max allowed: ")
          .concat(maxEls)
      ); // Remove script tags from the document.

    t._removeScripts(doc), t._prepDocument();
    title = t._articleTitle = (meta = t._getArticleMetadata()).title;

    switch (!!(c = t._grabArticle())) {
      case true:
        Object.entries(t.__clocks).forEach(function(a) {
          console.log(`\n**  ${a[0]}  **\n`, clockReport(a[1]))
          // console.log(a[1])
        })

        return (
          t.log("Grabbed: " + c.innerHTML),
          t._postProcessContent(c),
          {
            title: title,
            byline: !!(byline = meta.byline) ? byline : t._articleByline,
            dir: t._articleDir,
            content: c.innerHTML,
            textContent: (text = c.textContent),
            length: text.length,
            // If we haven't found an excerpt in the article's metadata, use the article's
            // first paragraph as the excerpt. This is used for displaying a preview of
            // the article's content.
            excerpt: !!(excerpt = meta.excerpt)
              ? excerpt
              : (paragraphs = c.getElementsByTagName("p")).length > 0
                ? paragraphs[0].textContent.trim()
                : undefined,
            siteName: !!(siteName = meta.siteName)
              ? siteName
              : t._articleSiteName
          }
        );

      case false:
        return null;
    }
  }
};

if (typeof module === 'object')
  module.exports = Readability;
