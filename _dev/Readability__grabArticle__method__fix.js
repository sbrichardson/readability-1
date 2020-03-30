Readability.prototype = {
  /***
   * grabArticle - Using a variety of metrics (content score, classname,
   * element types), find the content that is most likely to be the
   * stuff a user wants to read. Then return it wrapped up in a div.
   * @param page a document to run upon. Needs to be a full document, complete with body.
   * @return Element
   **/

  //
  //
  //
  //
  //
  //
  // NOTE Dev version, in progress
  //
  //
  //
  //
  //
  //

  _grabArticle___v2: function (page) {
    this.log('**** grabArticle ****')

    var t = this,
      doc = t._doc,
      regExps = t.REGEXPS,
      isPaging = page !== null ? true : false

    page = !!page ? page : doc.body

    // We can't grab an article if we don't have a page!
    if (!!page === false) {
      t.log('No body found in document. Abort.')
      return null
    }

    var pageCacheHtml = page.innerHTML

    while (true) {
      var stripUnlikelyCandidates = t._flagIsActive(t.FLAG_STRIP_UNLIKELYS),
        // First, node prepping. Trash nodes that look cruddy (like ones with the
        // class name "comment", etc), and turn divs into P tags where they have been
        // used inappropriately (as in, where they contain no other block level elements.)
        elementsToScore = [],
        node = doc.documentElement,
        matchString

      while (!!node) {
        matchString = node.className + ' ' + node.id

        if (!t._isProbablyVisible(node)) {
          t.log('Removing hidden node - ' + matchString)
          node = t._removeAndGetNext(node)
          continue
        }

        // Check to see if this node is a byline, and remove it if it is.
        if (t._checkByline(node, matchString)) {
          node = t._removeAndGetNext(node)
          continue
        }

        // Remove unlikely candidates
        if (stripUnlikelyCandidates)
          switch (node.tagName) {
            case 'BODY':
            case 'A':
              break
            default:
              if (
                regExps.unlikelyCandidates.test(matchString) &&
                !regExps.okMaybeItsACandidate.test(matchString) &&
                !t._hasAncestorTag(node, 'table')
              ) {
                t.log('Removing unlikely candidate - ' + matchString)
                node = t._removeAndGetNext(node)
                continue
              }
              break
          }

        // Remove DIV, SECTION, and HEADER nodes without any
        // content(e.g. text, image, video, or iframe).
        // NOTE Changed to switch
        switch (node.tagName) {
          case 'DIV':
          case 'SECTION':
          case 'HEADER':
          case 'H1':
          case 'H2':
          case 'H3':
          case 'H4':
          case 'H5':
          case 'H6':
            if (t._isElementWithoutContent(node)) {
              node = t._removeAndGetNext(node)
              continue
            }
            break
          default:
            break
        }

        if (t.DEFAULT_TAGS_TO_SCORE.includes(node.tagName))
          elementsToScore[elementsToScore.length] = node

        // Turn all divs that don't have children block level elements into p's
        if (node.tagName === 'DIV') {
          // Put phrasing content into paragraphs.
          var p = null,
            childNode = node.firstChild,
            nextSibling

          while (!!childNode) {
            nextSibling = childNode.nextSibling

            if (t._isPhrasingContent(childNode)) {
              if (p !== null) p.appendChild(childNode)
              else if (!t._isWhitespace(childNode)) {
                p = doc.createElement('p')
                node.replaceChild(p, childNode)
                p.appendChild(childNode)
              }
            } else if (p !== null) {
              while (!!p.lastChild && t._isWhitespace(p.lastChild)) {
                p.removeChild(p.lastChild)
              }
              p = null
            }
            childNode = nextSibling
          }

          // Sites like http://mobile.slate.com encloses each paragraph with a DIV
          // element. DIVs with only a P element inside and no text content can be
          // safely converted into plain P elements to avoid confusing the scoring
          // algorithm with DIVs with are, in practice, paragraphs.
          if (
            t._hasSingleTagInsideElement(node, 'P') &&
            t._getLinkDensity(node) < 0.25
          ) {
            var newNode = node.children[0]
            node.parentNode.replaceChild(newNode, node)
            node = newNode
            elementsToScore[elementsToScore.length] = node
          } else if (!t._hasChildBlockElement(node)) {
            node = t._setNodeTag(node, 'P')
            elementsToScore[elementsToScore.length] = node
          }
        }

        node = t._getNextNode(node)
      }

      // Loop through all paragraphs, and assign a score to them based on
      // how content-y they look.
      // Then add their score to their parent node.
      // A score is determined by things like number of commas, class names, etc.
      // Maybe eventually link density.

      var candidates = []

      t._forEachNode(elementsToScore, function (elToScore) {
        if (
          !!elToScore.parentNode === false ||
          typeof elToScore.parentNode.tagName === 'undefined'
        )
          return

        // If this paragraph is less than 25 characters, don't even count it.
        var innerText = t._getInnerText(elToScore)
        if (innerText.length < 25) return

        // Exclude nodes with no ancestor.
        var ancestors = t._getNodeAncestors(elToScore, 3)
        if (ancestors.length === 0) return

        var contentScore = 0

        // Add a point for the paragraph itself as a base.
        contentScore += 1

        // Add points for any commas within this paragraph.
        contentScore += innerText.split(',').length

        // For every 100 characters in this paragraph, add another point. Up to 3 points.
        contentScore += mathMin(mathFloor(innerText.length / 100), 3)

        // Initialize and score ancestors.
        t._forEachNode(ancestors, function (ancestorNode, level) {
          if (
            !!ancestorNode.tagName === false ||
            !!ancestorNode.parentNode === false ||
            typeof ancestorNode.parentNode.tagName === 'undefined'
          )
            return

          if (typeof ancestorNode.readability === 'undefined') {
            t._initializeNode(ancestorNode)
            candidates[candidates.length] = ancestorNode
          }

          // Node score divider:
          // - parent:             1 (no division)
          // - grandparent:        2
          // - great grandparent+: ancestorNode level * 3

          var scoreDivider = level === 0 ? 1 : level === 1 ? 2 : level * 3

          ancestorNode.readability.contentScore += contentScore / scoreDivider
        })
      })

      // After we've calculated scores, loop through all of the possible
      // candidate nodes we found and find the one with the highest score.
      var topCands = [],
        candidate,
        candScore,
        cl = candidates.length,
        c = 0

      for (; c < cl; ++c) {
        candidate = candidates[c]

        // Scale the final candidates score based on link density. Good content
        // should have a relatively small link density (5% or less) and be mostly
        // unaffected by this operation.
        candScore =
          candidate.readability.contentScore *
          (1 - t._getLinkDensity(candidate))

        candidate.readability.contentScore = candScore

        t.log('Candidate:', candidate, 'with score ' + candScore)

        for (var tc = 0; tc < t._nbTopCandidates; ++tc) {
          var aTopCandidate = topCands[tc]

          if (
            !!aTopCandidate === false ||
            candScore > aTopCandidate.readability.contentScore
          ) {
            topCands.splice(tc, 0, candidate)
            topCands.length > t._nbTopCandidates && topCands.pop()
            break
          }
        }
      }

      var topCandidate = topCands[0] || null,
        neededToCreateTopCandidate = false,
        parentOfTopCandidate

      // If we still have no top candidate, just use the body as a last resort.
      // We also have to copy the body node so it is something we can modify.
      if (topCandidate === null || topCandidate.tagName === 'BODY') {
        // Move all of the page's children into topCandidate
        topCandidate = doc.createElement('DIV')
        neededToCreateTopCandidate = true

        // Move everything (not just elements, also text nodes etc.) into the container
        // so we even include text directly in the body:
        var kids = page.childNodes

        while (kids.length) {
          t.log('Moving child out:', kids[0])
          topCandidate.appendChild(kids[0])
        }

        page.appendChild(topCandidate)

        t._initializeNode(topCandidate)
      } else if (!!topCandidate) {
        // Find a better top candidate node if it contains
        // (at least three) nodes which belong to `topCands` array
        // and whose scores are quite closed with current `topCandidate` node.

        var altCandAncestors = [],
          i = 1

        for (; i < topCands.length; ++i) {
          if (
            topCands[i].readability.contentScore /
              topCandidate.readability.contentScore >=
            0.75
          )
            altCandAncestors[altCandAncestors.length] = t._getNodeAncestors(
              topCands[i]
            )
        }

        var MIN_TOPCAND = 3

        if (altCandAncestors.length >= MIN_TOPCAND) {
          parentOfTopCandidate = topCandidate.parentNode

          while (parentOfTopCandidate.tagName !== 'BODY') {
            var listsContainingThisAncestor = 0,
              ancestorIndex = 0

            for (
              ;
              ancestorIndex < altCandAncestors.length &&
              listsContainingThisAncestor < MIN_TOPCAND;
              ++ancestorIndex
            ) {
              listsContainingThisAncestor += Number(
                altCandAncestors[ancestorIndex].includes(parentOfTopCandidate)
              )
            }

            if (listsContainingThisAncestor >= MIN_TOPCAND) {
              topCandidate = parentOfTopCandidate
              break
            }

            parentOfTopCandidate = parentOfTopCandidate.parentNode
          }
        }

        !!topCandidate.readability === false && t._initializeNode(topCandidate)

        // Because of our bonus system, parents of candidates might have scores
        // themselves. They get half of the node. There won't be nodes with higher
        // scores than our topCandidate, but if we see the score going *up* in the first
        // few steps up the tree, that's a decent sign that there might be more content
        // lurking in other places that we want to unify in. The sibling stuff
        // below does some of that - but only if we've looked high enough up the DOM
        // tree.
        parentOfTopCandidate = topCandidate.parentNode

        var lastScore = topCandidate.readability.contentScore,
          // The scores shouldn't get too low.
          scoreThreshold = lastScore / 3

        while (parentOfTopCandidate.tagName !== 'BODY') {
          if (!!parentOfTopCandidate.readability === false) {
            parentOfTopCandidate = parentOfTopCandidate.parentNode
            continue
          }

          var parentScore = parentOfTopCandidate.readability.contentScore

          if (parentScore < scoreThreshold) break
          if (parentScore > lastScore) {
            // Alright! We found a better parent to use.
            topCandidate = parentOfTopCandidate
            break
          }
          lastScore = parentOfTopCandidate.readability.contentScore
          parentOfTopCandidate = parentOfTopCandidate.parentNode
        }

        // If the top candidate is the only child, use parent instead.
        // This will help sibling joining logic when adjacent content
        // is actually located in parent's sibling node.

        parentOfTopCandidate = topCandidate.parentNode

        while (
          parentOfTopCandidate.tagName != 'BODY' &&
          parentOfTopCandidate.children.length == 1
        ) {
          topCandidate = parentOfTopCandidate
          parentOfTopCandidate = topCandidate.parentNode
        }

        !!topCandidate.readability === false && t._initializeNode(topCandidate)
      }

      // Now that we have the top candidate, look through its siblings for content
      // that might also be related. Things like preambles, content split by ads
      // that we removed, etc.
      var articleContent = doc.createElement('DIV')

      if (isPaging) articleContent.id = 'readability-content'

      var siblingScoreThreshold = mathMax(
        10,
        topCandidate.readability.contentScore * 0.2
      )

      // Keep potential top candidate's parent node to try
      // to get text direction of it later.

      parentOfTopCandidate = topCandidate.parentNode

      var siblings = parentOfTopCandidate.children,
        sl = siblings.length,
        s = 0

      for (; s < sl; ++s) {
        var sibling = siblings[s],
          append = false

        t.log(
          'Looking at sibling node:',
          sibling,
          sibling.readability
            ? 'with score ' + sibling.readability.contentScore
            : ''
        )

        t.log(
          'Sibling has score',
          sibling.readability ? sibling.readability.contentScore : 'Unknown'
        )

        if (sibling === topCandidate) append = true
        else {
          var contentBonus = 0
          // Give a bonus if sibling nodes and top candidates have the example same classname
          if (
            sibling.className === topCandidate.className &&
            topCandidate.className !== ''
          )
            contentBonus += topCandidate.readability.contentScore * 0.2

          if (
            !!sibling.readability &&
            sibling.readability.contentScore + contentBonus >=
              siblingScoreThreshold
          )
            append = true
          else if (sibling.nodeName === 'P') {
            var linkDensity = t._getLinkDensity(sibling),
              nodeContent = t._getInnerText(sibling),
              nodeLength = nodeContent.length

            if (nodeLength > 80 && linkDensity < 0.25) append = true
            else if (
              nodeLength < 80 &&
              nodeLength > 0 &&
              linkDensity === 0 &&
              nodeContent.search(/\.( |$)/) !== -1
            )
              append = true
          }
        }

        if (append) {
          t.log('Appending node:', sibling)

          if (!t.ALTER_TO_DIV_EXCEPTIONS.includes(sibling.nodeName)) {
            // We have a node that isn't a common block level
            // element, like a form or td tag. Turn it into a div
            // so it doesn't get filtered out later by accident.

            t.log('Altering sibling:', sibling, 'to div.')

            sibling = t._setNodeTag(sibling, 'DIV')
          }

          articleContent.appendChild(sibling)

          // Siblings is a reference to the children array, and
          // sibling is removed from the array when we call appendChild().
          // As a result, we must revisit this index since the nodes
          // have been shifted.
          s -= 1
          sl -= 1
        }
      }

      // So we have all of the content that we need. Now we
      // clean it up for presentation.

      switch (!!t._debug) {
        case false:
          t._prepArticle(articleContent)
          break

        case true:
          t.log('Article content pre-prep: ' + articleContent.innerHTML)
          t._prepArticle(articleContent)

          t.log('Article content post-prep: ' + articleContent.innerHTML)
          break
      }

      if (neededToCreateTopCandidate) {
        // We already created a fake div thing, and there wouldn't
        // have been any siblings left for the previous loop, so
        // there's no point trying to create a new div, and then
        // move all the children over. Just assign IDs and class
        // names here. No need to append because that already
        // happened anyway.

        topCandidate.id = 'readability-page-1'
        topCandidate.className = 'page'
      } else {
        var div = doc.createElement('DIV')

        div.id = 'readability-page-1'
        div.className = 'page'

        var children = articleContent.childNodes

        while (children.length) {
          div.appendChild(children[0])
        }

        articleContent.appendChild(div)
      }

      t._debug &&
        t.log('Article content after paging: ' + articleContent.innerHTML)

      // Now that we've gone through the full algorithm, check
      // to see if we got any meaningful content. If we didn't,
      // we may need to re-run grabArticle with different flags set.
      // This gives us a higher likelihood of finding the content,
      // and the sieve approach gives us a higher likelihood of
      // finding the -right- content.

      var parseSuccessful = true,
        textLength = t._getInnerText(articleContent, true).length

      if (textLength < t._charThreshold) {
        parseSuccessful = false
        page.innerHTML = pageCacheHtml

        if (t._flagIsActive(t.FLAG_STRIP_UNLIKELYS)) {
          t._removeFlag(t.FLAG_STRIP_UNLIKELYS)
          t._attempts[t._attempts.length] = { articleContent, textLength }
        } else if (t._flagIsActive(t.FLAG_WEIGHT_CLASSES)) {
          t._removeFlag(t.FLAG_WEIGHT_CLASSES)
          t._attempts[t._attempts.length] = { articleContent, textLength }
        } else if (t._flagIsActive(t.FLAG_CLEAN_CONDITIONALLY)) {
          t._removeFlag(t.FLAG_CLEAN_CONDITIONALLY)
          t._attempts[t._attempts.length] = { articleContent, textLength }
        } else {
          t._attempts[t._attempts.length] = { articleContent, textLength }

          // No luck after removing flags, just return the longest
          // text we found during the different loops
          t._attempts.sort(attemptsSortFn)

          // But first check if we actually have something
          if (!!t._attempts[0].textLength) {
            articleContent = t._attempts[0].articleContent
            parseSuccessful = true
          } else return null
        }
      }

      if (parseSuccessful) {
        // Find out text direction from ancestors of final top candidate.
        var ancestors = [parentOfTopCandidate, topCandidate].concat(
          t._getNodeAncestors(parentOfTopCandidate)
        )

        t._someNode(ancestors, function (ancestorNode) {
          var articleDir

          if (
            !!ancestorNode.tagName &&
            !!(articleDir = ancestorNode.getAttribute('dir'))
          ) {
            t._articleDir = articleDir
            return true
          }

          return false
        })

        return articleContent
      }
    }
  },
}
