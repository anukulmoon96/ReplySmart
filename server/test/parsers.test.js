import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../src/errors.js';
import { guessMe, parseConversation } from '../src/parsers/index.js';

const samplesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'samples');
const sample = (name) => fs.readFileSync(path.join(samplesDir, name), 'utf8');

const simplify = (r) => r.messages.map((m) => [m.sender, m.text]);

describe('WhatsApp', () => {
  test('Android 12-hour export: skips system lines, keeps multi-line messages, guesses me', () => {
    const r = parseConversation(sample('whatsapp-weekend-plans.txt'));
    assert.equal(r.platform, 'whatsapp');
    assert.deepEqual(r.participants, ['Priya', 'Rahul']);
    assert.equal(r.suggestedMe, 'Rahul');
    assert.equal(r.messages.length, 7);
    assert.equal(r.messages[5].text, '[media omitted]');
    assert.equal(r.messages[6].text, "Hey, you didn't reply 😅\nThey need me to confirm the booking by tonight");
    const last = r.messages[6].timestamp;
    assert.deepEqual([last.getFullYear(), last.getMonth(), last.getDate(), last.getHours(), last.getMinutes()], [2026, 10, 20, 18, 48]);
  });

  test('iOS export with brackets, seconds, direction marks and DD/MM dates', () => {
    const text = [
      '‎[05/11/2026, 21:15:42] Ana: ‎image omitted',
      '[05/11/2026, 21:16:03] Ben: Nice! When are you back?',
      '[13/11/2026, 08:01:10] Ana: Thursday',
      'around 6',
    ].join('\r\n');
    const r = parseConversation(text);
    assert.equal(r.platform, 'whatsapp');
    assert.deepEqual(simplify(r), [
      ['Ana', '[image omitted]'],
      ['Ben', 'Nice! When are you back?'],
      ['Ana', 'Thursday\naround 6'],
    ]);
    const d = r.messages[2].timestamp;
    assert.deepEqual([d.getMonth(), d.getDate(), d.getHours()], [10, 13, 8]);
  });

  test('narrow no-break space before AM/PM (newer Android exports)', () => {
    const r = parseConversation('1/2/26, 12:05 AM - Sam: late night\n1/2/26, 12:07 PM - Kim: lunch?');
    assert.equal(r.messages[0].timestamp.getHours(), 0);
    assert.equal(r.messages[1].timestamp.getHours(), 12);
  });
});

describe('Slack', () => {
  test('channel export JSON: names from profiles, mrkdwn cleanup, skips joins, sorts by ts', () => {
    const data = [
      { type: 'message', subtype: 'channel_join', user: 'U2', text: '<@U2> has joined the channel', ts: '1700000000.000100' },
      {
        type: 'message',
        user: 'U2',
        text: 'Sure, see <https://example.com/doc|the doc> &amp; ping <!here>',
        ts: '1700000200.000100',
        user_profile: { display_name: '', real_name: 'Bob Lee' },
      },
      {
        type: 'message',
        user: 'U1',
        text: 'Hey <@U2>, can you review <#C1|eng> PR?',
        ts: '1700000100.000100',
        user_profile: { display_name: 'alice', real_name: 'Alice Wong' },
      },
    ];
    const r = parseConversation(JSON.stringify(data));
    assert.equal(r.platform, 'slack');
    assert.deepEqual(simplify(r), [
      ['alice', 'Hey @Bob Lee, can you review #eng PR?'],
      ['Bob Lee', 'Sure, see the doc (https://example.com/doc) & ping @here'],
    ]);
    assert.equal(r.messages[0].timestamp.getTime(), 1700000100000);
  });

  test('text copied from the Slack app, including follow-up messages with only a time', () => {
    const r = parseConversation(sample('slack-demo-deadline.txt'));
    assert.equal(r.platform, 'slack');
    assert.equal(r.suggestedMe, 'Daniel Ortiz');
    assert.equal(r.messages.length, 6);
    assert.deepEqual(r.messages[3], {
      sender: 'Maya Chen',
      text: 'Also I need someone to run through the demo script with me on Wednesday',
      timestamp: null,
      timeLabel: '9:46 AM',
    });
  });

  test('a message line that ends in a time is not mistaken for a header', () => {
    const r = parseConversation('Maya Chen  9:41 AM\nLet us meet at 10:30\nDaniel Ortiz  9:44 AM\nok see you at 10:30');
    assert.deepEqual(simplify(r), [
      ['Maya Chen', 'Let us meet at 10:30'],
      ['Daniel Ortiz', 'ok see you at 10:30'],
    ]);
  });
});

describe('Microsoft Teams', () => {
  test('text copied from classic Teams ([time] Name headers)', () => {
    const r = parseConversation(sample('teams-vendor-report.txt'));
    assert.equal(r.platform, 'teams');
    assert.deepEqual(r.participants, ['Laura Bennett', 'Arjun Mehta']);
    assert.equal(r.suggestedMe, 'Arjun Mehta');
    assert.equal(r.messages.length, 4);
    assert.match(r.messages[2].text, /^Hi Laura!.*\nI'll double-check/s);
  });

  test('text copied from new Teams (name line, then a time line)', () => {
    const r = parseConversation('Laura Bennett\nYesterday 4:15 PM\nCan you send it today?\n\nArjun Mehta\n4:20 PM\nOn it!');
    assert.equal(r.platform, 'teams');
    assert.deepEqual(simplify(r), [
      ['Laura Bennett', 'Can you send it today?'],
      ['Arjun Mehta', 'On it!'],
    ]);
    assert.equal(r.messages[0].timeLabel, 'Yesterday 4:15 PM');
  });

  test('Microsoft Graph chatMessage JSON (newest first, HTML bodies, system events)', () => {
    const data = {
      value: [
        {
          messageType: 'message',
          createdDateTime: '2026-11-20T10:05:00Z',
          from: { user: { displayName: 'Arjun Mehta' } },
          body: { contentType: 'html', content: '<p>Will do &amp; I&#39;ll add a slide.</p>' },
        },
        { messageType: 'systemEventMessage', createdDateTime: '2026-11-20T10:01:00Z', from: null, body: { content: '<systemEventMessage/>' } },
        {
          messageType: 'message',
          createdDateTime: '2026-11-20T10:00:00Z',
          from: { user: { displayName: 'Laura Bennett' } },
          body: { contentType: 'html', content: '<div>Can you send the breakdown?<br>Before Friday.</div>' },
        },
      ],
    };
    const r = parseConversation(JSON.stringify(data));
    assert.equal(r.platform, 'teams');
    assert.deepEqual(simplify(r), [
      ['Laura Bennett', 'Can you send the breakdown?\nBefore Friday.'],
      ['Arjun Mehta', "Will do & I'll add a slide."],
    ]);
  });

  test('personal data export JSON (MessageList)', () => {
    const data = {
      conversations: [
        {
          MessageList: [
            { displayName: 'Kim', content: 'hello <b>there</b>', originalarrivaltime: '2026-01-01T09:00:00Z', messagetype: 'RichText/Html' },
            { displayName: null, content: '<addmember/>', originalarrivaltime: '2026-01-01T08:00:00Z', messagetype: 'ThreadActivity/AddMember' },
          ],
        },
      ],
    };
    const r = parseConversation(JSON.stringify(data));
    assert.deepEqual(simplify(r), [['Kim', 'hello there']]);
    assert.equal(r.suggestedMe, 'Me');
  });
});

describe('generic and detection', () => {
  test('"Name: message" lines with optional time prefixes', () => {
    const r = parseConversation('[10:32] Alice: hi\nare you around?\n10:35 PM - Bob: yep\nAlice: great');
    assert.equal(r.platform, 'generic');
    assert.deepEqual(simplify(r), [
      ['Alice', 'hi\nare you around?'],
      ['Bob', 'yep'],
      ['Alice', 'great'],
    ]);
    assert.equal(r.messages[0].timeLabel, '10:32');
  });

  test('a named platform overrides the detected label', () => {
    assert.equal(parseConversation('Alice: hi\nBob: hey', { platform: 'slack' }).platform, 'slack');
  });

  test('empty input is a 400 and unrecognisable text is a 422', () => {
    assert.throws(() => parseConversation('   '), (e) => e instanceof HttpError && e.status === 400);
    assert.throws(() => parseConversation('just some words\nwith no senders'), (e) => e instanceof HttpError && e.status === 422);
    assert.throws(() => parseConversation('{"foo": 1}'), (e) => e instanceof HttpError && e.status === 422);
  });
});

describe('guessMe', () => {
  const msgs = (...senders) => senders.map((sender) => ({ sender, text: 'x' }));
  test('picks a participant literally named You/Me', () => {
    assert.equal(guessMe(msgs('Ann', 'You', 'Ann'), ['Ann', 'You']), 'You');
  });
  test('in a group chat, picks the latest sender who is not the last speaker', () => {
    assert.equal(guessMe(msgs('A', 'B', 'C', 'C'), ['A', 'B', 'C']), 'B');
  });
});
