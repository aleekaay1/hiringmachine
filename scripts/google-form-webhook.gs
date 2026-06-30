/**
 * Paz portal — Google Form → questionnaire webhook
 *
 * Setup:
 * 1. Open your Google Form (edit mode)
 * 2. ⋮ (top right) → Script editor  (or Extensions → Apps Script)
 * 3. Paste this entire file, set WEBHOOK_URL below, Save
 * 4. Run installFormSubmitTrigger once → authorize → allow
 * 5. Submit a test response on the form
 */

/** Replace only if your Supabase project / secret changes */
var WEBHOOK_URL = 'https://hlfufjrjztuknioydlut.supabase.co/functions/v1/google-form-questionnaire-webhook?secret=paz-wg-hook-hlfufjrjztuknioydlut-2026';

function onFormSubmit(e) {
  sendFormResponseToPaz(e);
}

/** Run once from the editor to register the submit trigger */
function installFormSubmitTrigger() {
  var form = FormApp.getActiveForm();
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onFormSubmit') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('onFormSubmit')
    .forForm(form)
    .onFormSubmit()
    .create();
  Logger.log('Trigger installed for form: ' + form.getTitle());
}

/** Re-send the most recent form response (for testing without a new submit) */
function testLastResponse() {
  var responses = FormApp.getActiveForm().getResponses();
  if (!responses.length) {
    Logger.log('No responses yet — submit the form once first.');
    return;
  }
  var last = responses[responses.length - 1];
  sendFormResponseToPaz({ response: last });
}

function sendFormResponseToPaz(e) {
  if (!e || !e.response) {
    Logger.log('Missing form response event');
    return;
  }

  var response = e.response;
  var form = FormApp.getActiveForm();
  var answers = [];
  var email = '';
  var firstName = '';
  var lastName = '';
  var phone = '';
  var recruiter = '';

  var itemResponses = response.getItemResponses();
  for (var i = 0; i < itemResponses.length; i++) {
    var itemResponse = itemResponses[i];
    var title = itemResponse.getItem().getTitle();
    var answer = itemResponse.getResponse();
    if (Array.isArray(answer)) answer = answer.join(', ');
    answer = String(answer || '').trim();
    if (!answer) continue;

    var lower = title.toLowerCase();
    if (!email && lower.indexOf('email') !== -1) email = answer;
    if (!firstName && lower.indexOf('first') !== -1 && lower.indexOf('name') !== -1) firstName = answer;
    if (!lastName && lower.indexOf('last') !== -1 && lower.indexOf('name') !== -1) lastName = answer;
    if (!phone && (lower.indexOf('phone') !== -1 || lower.indexOf('mobile') !== -1 || lower.indexOf('cell') !== -1)) {
      phone = answer;
    }
    if (!recruiter && (lower.indexOf('recruiter') !== -1 || lower.indexOf('agent') !== -1 || lower.indexOf('who invited') !== -1)) {
      recruiter = answer;
    }

    answers.push({ question: title, answer: answer });
  }

  try {
    var respondentEmail = response.getRespondentEmail();
    if (!email && respondentEmail) email = String(respondentEmail).trim();
  } catch (err) {}

  var payload = {
    source: 'google_form',
    response_id: response.getId(),
    form_id: form.getId(),
    form_title: form.getTitle(),
    submitted_at: response.getTimestamp().toISOString(),
    email: email,
    first_name: firstName,
    last_name: lastName,
    phone: phone,
    recruiter_custom_field: recruiter,
    answers: answers
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var res = UrlFetchApp.fetch(WEBHOOK_URL, options);
  Logger.log('Paz webhook ' + res.getResponseCode() + ': ' + res.getContentText());
}
