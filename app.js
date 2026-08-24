/*
 * Yahtzee scorecard UI.
 *
 * Renders one column per player, opens a picker of the legal scores when a box
 * is tapped, and recomputes every total from scoring.js after each change.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'yahtzee-scorecard-v1';
  var MAX_PLAYERS = 8;

  var state = { players: [] };
  var entry = null;      // { playerIndex, categoryId } while the sheet is open
  var focusAfterRender = null;

  var table = document.getElementById('scorecard');
  var sheet = document.getElementById('entry');
  var sheetTitle = document.getElementById('entry-title');
  var sheetSub = document.getElementById('entry-sub');
  var sheetOptions = document.getElementById('entry-options');
  var clearButton = document.getElementById('entry-clear');
  var progressLine = document.getElementById('progress');
  var confirmSheet = document.getElementById('confirm');
  var confirmTitle = document.getElementById('confirm-title');
  var confirmText = document.getElementById('confirm-text');
  var confirmOk = document.getElementById('confirm-ok');
  var confirmCancel = document.getElementById('confirm-cancel');
  var scrim = document.getElementById('scrim');

  /* ---------- dialogs ---------- */

  var FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  /**
   * Opens a sheet, falling back to a non-modal dialog with our own scrim when
   * the host won't grant a modal one (a sandboxed frame without allow-modals).
   *
   * The fallback is chosen by asking whether the dialog actually opened rather
   * than by catching: the spec has a blocked showModal() *return* silently, so
   * a thrown error is only one of the two ways it can be refused. Miss the
   * silent one and the button looks dead.
   */
  function openDialog(dialog) {
    if (dialog.open) return;

    try {
      dialog.showModal();
    } catch (err) {
      /* refused loudly — handled the same as being refused quietly */
    }

    if (dialog.open) {
      dialog.classList.remove('no-modal');
      return;
    }

    dialog.classList.add('no-modal');
    scrim.hidden = false;
    dialog.show();
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
    dialog.classList.remove('no-modal');
    if (!sheet.open && !confirmSheet.open) scrim.hidden = true;
  }

  /** The open fallback dialog, innermost first. Null while modals work. */
  function fallbackDialog() {
    if (confirmSheet.open && confirmSheet.classList.contains('no-modal')) return confirmSheet;
    if (sheet.open && sheet.classList.contains('no-modal')) return sheet;
    return null;
  }

  function dismissFallback(dialog) {
    if (dialog === confirmSheet) resolveConfirm(false);
    else closeEntry();
  }

  // A modal dialog gets Escape and a focus trap from the browser. The fallback
  // has to provide both itself, or focus walks off behind the scrim.
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var dialog = fallbackDialog();
    if (dialog) dismissFallback(dialog);
  });

  document.addEventListener('focusin', function (event) {
    var dialog = fallbackDialog();
    if (!dialog || dialog.contains(event.target)) return;
    var first = dialog.querySelector(FOCUSABLE);
    if (first) first.focus();
  });

  var pendingConfirm = null;

  /**
   * Asks the question in-page rather than through window.confirm, which a
   * sandboxed frame answers "false" without ever showing the user anything.
   */
  function askConfirm(title, message, okLabel, onConfirm) {
    confirmTitle.textContent = title;
    confirmText.textContent = message;
    confirmOk.textContent = okLabel;
    pendingConfirm = onConfirm;
    openDialog(confirmSheet);
    confirmOk.focus();
  }

  function resolveConfirm(confirmed) {
    var action = pendingConfirm;
    pendingConfirm = null;
    closeDialog(confirmSheet);
    if (confirmed && action) action();
  }

  /* ---------- state ---------- */

  var nextId = 1;
  function newPlayer(name) {
    return { id: 'p' + nextId++, name: name, scores: {}, yahtzeeBonus: 0 };
  }

  function defaultState() {
    return { players: [newPlayer('Player 1'), newPlayer('Player 2')] };
  }

  function load() {
    var raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return defaultState();   // private mode, storage disabled — play unsaved
    }
    if (!raw) return defaultState();

    try {
      var saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.players) || !saved.players.length) return defaultState();

      var players = saved.players.slice(0, MAX_PLAYERS).map(function (stored, index) {
        var player = stored || {};
        var clean = newPlayer(typeof player.name === 'string' ? player.name : 'Player ' + (index + 1));
        var scores = player.scores || {};
        Scoring.CATEGORIES.forEach(function (category) {
          var value = scores[category.id];
          // Drop anything the rules can't produce rather than trusting storage.
          if (Scoring.isFilled(value) && Scoring.isValidValue(category.id, value)) {
            clean.scores[category.id] = value;
          }
        });
        clean.yahtzeeBonus = Scoring.scoreCard({ yahtzeeBonus: player.yahtzeeBonus }).yahtzeeBonusCount;
        return clean;
      });
      return { players: players };
    } catch (err) {
      return defaultState();
    }
  }

  function save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      /* out of space or storage blocked — the game still plays, just unsaved */
    }
  }

  /**
   * The footer promises the game is saved. Where the browser won't allow that
   * — private windows, blocked site data, a frame without storage access —
   * say so instead, so nobody loses a card to a promise we can't keep.
   */
  function warnIfUnsaved() {
    var tip = document.getElementById('tip');
    if (!tip) return;
    try {
      var probe = STORAGE_KEY + ':probe';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
    } catch (err) {
      tip.textContent = 'Tap any box to enter a score — totals are worked out for you. '
        + 'This browser is blocking saved data, so reloading the page will clear the card.';
    }
  }

  function commit() {
    save();
    render();
  }

  function anyScores() {
    return state.players.some(function (player) {
      return Scoring.scoreCard(player).boxesFilled > 0 || player.yahtzeeBonus > 0;
    });
  }

  /* ---------- dom helpers ---------- */

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) {
      if (key === 'class') node.className = props[key];
      else if (key === 'text') node.textContent = props[key];
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), props[key]);
      else if (props[key] !== null && props[key] !== undefined) node.setAttribute(key, props[key]);
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  /**
   * Tags a node with the player it belongs to and an aria-label template
   * holding a {name} slot, so renaming can refresh the label in place instead
   * of forcing a re-render that would interrupt typing.
   */
  function withLabel(props, player, template) {
    props['data-player-id'] = player.id;
    props['data-label-template'] = template;
    props['aria-label'] = template.replace('{name}', player.name);
    return props;
  }

  function refreshPlayerLabels(player) {
    var nodes = table.querySelectorAll('[data-player-id="' + player.id + '"][data-label-template]');
    Array.prototype.forEach.call(nodes, function (node) {
      var text = node.getAttribute('data-label-template').replace('{name}', player.name);
      node.setAttribute('aria-label', text);
      if (node.hasAttribute('title')) node.title = text;
    });
  }

  function categoryHead(category) {
    return el('th', { class: 'row-head', scope: 'row' }, [
      document.createTextNode(category.label),
      el('span', { class: 'hint', text: category.hint })
    ]);
  }

  function totalRow(label, values, options) {
    options = options || {};
    var row = el('tr', { class: 'total-row' + (options.rowClass ? ' ' + options.rowClass : '') });
    row.appendChild(el('th', { class: 'row-head', scope: 'row' }, [
      document.createTextNode(label),
      options.hint ? el('span', { class: 'hint', text: options.hint }) : null
    ]));
    values.forEach(function (value, index) {
      var cell = el('td', {});
      if (options.highlight && options.highlight.indexOf(index) !== -1) cell.className = 'leader';
      cell.appendChild(el('span', { class: 'total-value' + (value.className ? ' ' + value.className : '') }, [
        document.createTextNode(String(value.main)),
        value.sub ? el('span', { class: 'sub', text: value.sub }) : null
      ]));
      row.appendChild(cell);
    });
    return row;
  }

  function sectionLabelRow(label, columns) {
    var row = el('tr', { class: 'section-label' });
    row.appendChild(el('th', { colspan: columns + 1, scope: 'colgroup', text: label }));
    return row;
  }

  /* ---------- rendering ---------- */

  function render() {
    var players = state.players;
    var totals = players.map(function (player) { return Scoring.scoreCard(player); });
    var leaders = Scoring.findLeaders(players);

    table.textContent = '';
    table.appendChild(el('caption', { class: 'visually-hidden', text: 'Yahtzee scorecard' }));
    table.appendChild(renderHead(players));
    table.appendChild(renderSection(Scoring.UPPER, 'Upper section', players, totals, function (body) {
      body.appendChild(totalRow('Upper subtotal', totals.map(function (t) {
        return { main: t.upperSubtotal };
      })));
      body.appendChild(totalRow('Bonus', totals.map(function (t) {
        return t.bonusEarned
          ? { main: Scoring.UPPER_BONUS, sub: 'earned', className: 'bonus-earned' }
          : { main: 0, sub: t.pointsToBonus + ' to go' };
      }), { hint: '35 if subtotal reaches ' + Scoring.UPPER_BONUS_THRESHOLD }));
      body.appendChild(totalRow('Upper total', totals.map(function (t) {
        return { main: t.upperTotal };
      })));
    }));
    table.appendChild(renderSection(Scoring.LOWER, 'Lower section', players, totals, function (body) {
      body.appendChild(renderBonusRow(players, totals));
      body.appendChild(totalRow('Lower total', totals.map(function (t) {
        return { main: t.lowerTotal };
      })));
      body.appendChild(totalRow('Grand total', totals.map(function (t) {
        return { main: t.grandTotal };
      }), { rowClass: 'grand-row', highlight: leaders }));
    }));

    renderProgress(totals, leaders);
    document.getElementById('add-player').disabled = players.length >= MAX_PLAYERS;

    if (focusAfterRender) {
      // A leading "#" targets a control outside the table, which render()
      // leaves standing; anything else is a cell key inside the rebuilt table.
      var restore = focusAfterRender.charAt(0) === '#'
        ? document.querySelector(focusAfterRender)
        : table.querySelector('[data-focus-key="' + focusAfterRender + '"]');
      if (restore) restore.focus();
      focusAfterRender = null;
    }
  }

  function nameSize(name) {
    return Math.max(4, Math.min(14, (name || '').length + 1));
  }

  function renderHead(players) {
    var row = el('tr', {});
    row.appendChild(el('th', { class: 'row-head', scope: 'col', text: 'Category' }));

    players.forEach(function (player, index) {
      var remove = players.length > 1 ? el('button', withLabel({
        type: 'button',
        class: 'remove-player',
        title: 'Remove ' + player.name,
        onclick: function () { removePlayer(index); }
      }, player, 'Remove {name}'), [document.createTextNode('×')]) : null;

      var input = el('input', {
        class: 'name-input',
        type: 'text',
        value: player.name,
        maxlength: '14',
        size: nameSize(player.name),
        'aria-label': 'Name of player ' + (index + 1),
        oninput: function (event) {
          // Re-rendering here would steal focus mid-word, so patch the places
          // the name appears outside this input instead.
          player.name = event.target.value;
          event.target.size = nameSize(player.name);
          refreshPlayerLabels(player);
          refreshProgress();
          save();
        },
        onblur: function (event) {
          if (!event.target.value.trim()) {
            player.name = 'Player ' + (index + 1);
            commit();
          }
        }
      });

      var head = el('div', { class: 'player-head' }, [input, remove]);

      row.appendChild(el('th', { class: 'player-col', scope: 'col' }, [head]));
    });

    return el('thead', {}, [row]);
  }

  function renderSection(categories, label, players, totals, appendTotals) {
    var body = el('tbody', {});
    body.appendChild(sectionLabelRow(label, players.length));

    categories.forEach(function (category) {
      var row = el('tr', {});
      row.appendChild(categoryHead(category));
      players.forEach(function (player, playerIndex) {
        row.appendChild(el('td', {}, [scoreCell(player, playerIndex, category)]));
      });
      body.appendChild(row);
    });

    appendTotals(body);
    return body;
  }

  function scoreCell(player, playerIndex, category) {
    var value = player.scores[category.id];
    var filled = Scoring.isFilled(value);
    var key = player.id + ':' + category.id;
    var className = 'cell ' + (filled ? (value === 0 ? 'filled scratched' : 'filled') : 'empty');

    return el('button', withLabel({
      type: 'button',
      class: className,
      'data-focus-key': key,
      text: filled ? String(value) : '',
      onclick: function () { openEntry(playerIndex, category.id); }
    }, player, category.label + ', {name}: ' + (filled ? value + ' points' : 'empty')));
  }

  function renderBonusRow(players, totals) {
    var row = el('tr', { class: 'total-row' });
    row.appendChild(el('th', { class: 'row-head', scope: 'row' }, [
      document.createTextNode('Yahtzee bonus'),
      el('span', { class: 'hint', text: '+' + Scoring.YAHTZEE_BONUS + ' per extra Yahtzee' })
    ]));

    players.forEach(function (player, index) {
      var total = totals[index];
      var count = total.yahtzeeBonusCount;
      var stepper = el('div', { class: 'stepper' }, [
        el('button', withLabel({
          type: 'button',
          class: 'step',
          'data-focus-key': player.id + ':bonus-minus',
          disabled: count === 0 ? '' : null,
          text: '−',
          onclick: function () { changeBonus(index, -1, 'bonus-minus'); }
        }, player, 'One fewer bonus Yahtzee for {name}')),
        el('span', withLabel({
          class: 'bonus-count',
          text: count ? count + '×' + Scoring.YAHTZEE_BONUS : '0'
        }, player, '{name} has ' + count + ' bonus Yahtzees, ' + total.yahtzeeBonusPoints + ' points')),
        el('button', withLabel({
          type: 'button',
          class: 'step',
          'data-focus-key': player.id + ':bonus-plus',
          disabled: count >= Scoring.MAX_YAHTZEE_BONUS ? '' : null,
          text: '+',
          onclick: function () { changeBonus(index, 1, 'bonus-plus'); }
        }, player, 'One more bonus Yahtzee for {name}'))
      ]);
      row.appendChild(el('td', {}, [stepper]));
    });

    return row;
  }

  function refreshProgress() {
    var totals = state.players.map(function (player) { return Scoring.scoreCard(player); });
    renderProgress(totals, Scoring.findLeaders(state.players));
  }

  function renderProgress(totals, leaders) {
    var filled = totals.reduce(function (sum, t) { return sum + t.boxesFilled; }, 0);
    var capacity = totals.length * Scoring.CATEGORIES.length;

    if (!filled) {
      progressLine.textContent = 'Tap a box to start scoring';
      return;
    }

    if (leaders.length) {
      var names = leaders.map(function (i) { return state.players[i].name; });
      var points = totals[leaders[0]].grandTotal + ' points';
      if (totals.length === 1) progressLine.textContent = 'Final score — ' + points;
      else if (leaders.length === 1) progressLine.textContent = 'Final — ' + names[0] + ' wins with ' + points;
      else progressLine.textContent = 'Final — tie between ' + names.join(' & ') + ' at ' + points;
      return;
    }

    var best = -1;
    var bestIndex = [];
    totals.forEach(function (t, index) {
      if (t.grandTotal > best) { best = t.grandTotal; bestIndex = [index]; }
      else if (t.grandTotal === best) bestIndex.push(index);
    });

    var lead = totals.length === 1
      ? best + ' points'
      : (bestIndex.length > 1
        ? 'tied at ' + best
        : state.players[bestIndex[0]].name + ' leads with ' + best);

    progressLine.textContent = filled + ' of ' + capacity + ' boxes · ' + lead;
  }

  /* ---------- score entry ---------- */

  /**
   * Caption under a pickable score. Dice-total boxes get none: the number is
   * the whole story, and repeating the category under all 26 buttons is noise.
   */
  function optionLabel(category, value) {
    if (value === 0) return 'Scratch';
    if (category.section === 'upper') {
      var count = value / category.face;
      return count + (count === 1 ? ' die' : ' dice');
    }
    return category.kind === 'fixed' ? category.label : '';
  }

  function openEntry(playerIndex, categoryId) {
    var player = state.players[playerIndex];
    var category = Scoring.getCategory(categoryId);
    if (!player || !category) return;

    entry = { playerIndex: playerIndex, categoryId: categoryId };
    var current = player.scores[categoryId];

    sheetTitle.textContent = category.label;
    sheetSub.textContent = player.name + ' · ' + category.hint;

    var values = Scoring.validValues(categoryId);
    sheetOptions.textContent = '';
    sheetOptions.className = 'options'
      + (category.kind === 'fixed' ? ' wide' : '')
      + (category.kind === 'sum' ? ' compact' : '');

    // Fixed-score boxes read better as "score it / scratch it", so the real
    // score leads; elsewhere the values stay in their natural order.
    if (category.kind === 'fixed') values = values.slice().reverse();

    values.forEach(function (value) {
      var caption = optionLabel(category, value);
      var classes = 'opt' + (value === 0 ? ' zero' : '') + (value === current ? ' current' : '');
      sheetOptions.appendChild(el('button', {
        type: 'button',
        class: classes,
        'aria-label': value + ' points' + (caption ? ', ' + caption : ''),
        onclick: function () { setScore(playerIndex, categoryId, value); }
      }, [
        document.createTextNode(String(value)),
        caption ? el('span', { class: 'opt-sub', text: caption }) : null
      ]));
    });

    clearButton.disabled = !Scoring.isFilled(current);
    openDialog(sheet);
  }

  function closeEntry() {
    closeDialog(sheet);
    entry = null;
  }

  function setScore(playerIndex, categoryId, value) {
    if (!Scoring.isValidValue(categoryId, value)) return;
    state.players[playerIndex].scores[categoryId] = value;
    focusAfterRender = state.players[playerIndex].id + ':' + categoryId;
    closeEntry();
    commit();
  }

  function clearScore() {
    if (!entry) return;
    var player = state.players[entry.playerIndex];
    delete player.scores[entry.categoryId];
    focusAfterRender = player.id + ':' + entry.categoryId;
    closeEntry();
    commit();
  }

  function changeBonus(playerIndex, delta, focusSuffix) {
    var player = state.players[playerIndex];
    var next = Scoring.scoreCard({ yahtzeeBonus: player.yahtzeeBonus + delta }).yahtzeeBonusCount;
    if (next === player.yahtzeeBonus) return;
    player.yahtzeeBonus = next;
    focusAfterRender = player.id + ':' + focusSuffix;
    commit();
  }

  /* ---------- players & games ---------- */

  function addPlayer() {
    if (state.players.length >= MAX_PLAYERS) return;
    state.players.push(newPlayer('Player ' + (state.players.length + 1)));
    commit();
  }

  function removePlayer(index) {
    var player = state.players[index];
    if (state.players.length <= 1 || !player) return;

    var drop = function () {
      closeEntry();                     // never leave a sheet pointing at a gone player
      state.players.splice(index, 1);
      // The × that had focus is about to be destroyed; land somewhere real.
      focusAfterRender = '#add-player';
      commit();
    };

    var played = Scoring.scoreCard(player).boxesFilled > 0 || player.yahtzeeBonus > 0;
    if (!played) return drop();
    askConfirm('Remove ' + player.name + '?', 'Their scores go with them.', 'Remove', drop);
  }

  function newGame() {
    var reset = function () {
      closeEntry();
      state.players.forEach(function (player) {
        player.scores = {};
        player.yahtzeeBonus = 0;
      });
      commit();
    };

    if (!anyScores()) return reset();
    askConfirm('Start a new game?', 'Scores are cleared. Player names are kept.', 'New game', reset);
  }

  /* ---------- wiring ---------- */

  document.getElementById('add-player').addEventListener('click', addPlayer);
  document.getElementById('new-game').addEventListener('click', newGame);
  clearButton.addEventListener('click', clearScore);

  sheet.addEventListener('click', function (event) {
    if (event.target === sheet) closeEntry();   // tap outside the sheet
  });
  sheet.addEventListener('close', function () { entry = null; });
  sheet.querySelector('[data-close]').addEventListener('click', closeEntry);

  confirmOk.addEventListener('click', function () { resolveConfirm(true); });
  confirmCancel.addEventListener('click', function () { resolveConfirm(false); });
  confirmSheet.addEventListener('close', function () { pendingConfirm = null; });
  confirmSheet.addEventListener('click', function (event) {
    if (event.target === confirmSheet) resolveConfirm(false);
  });
  scrim.addEventListener('click', function () {
    if (confirmSheet.open) resolveConfirm(false);
    else if (sheet.open) closeEntry();
  });

  state = load();
  render();
  warnIfUnsaved();
})();
