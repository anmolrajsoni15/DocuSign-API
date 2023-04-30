const express = require("express");
const path = require("path");
const fs = require("fs");
const bodyParser = require("body-parser");
const session = require("express-session");
const dotenv = require("dotenv");
dotenv.config();
const docusign = require("docusign-esign");

const port = 4000;
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, "success")));
app.use(
  session({
    secret: "aljfaolgriga",
    resave: true,
    saveUninitialized: true,
  })
);

app.post("/send-envelope", async (req, res) => {
  await checkToken(req, res);

  let envelopesApi = getEnvelopesApi(req, res);
  let clientId = generateUniqueId();

  // Make the envelope request body
  let envelope = makeEnvelope(req.body.name, req.body.email, req.body.company, clientId);

  // Call Envelopes::create API method
  // Exceptions will be caught by the calling function
  let results = await envelopesApi.createEnvelope(process.env.ACCOUNT_ID, {
    envelopeDefinition: envelope,
  });

  // Create the recipient view, the Signing Ceremony
  let viewRequest = makeRecipientViewRequest(req.body.name, req.body.email, clientId);
  // Call the CreateRecipientView API
  // Exceptions will be caught by the calling function
  results = await envelopesApi.createRecipientView(
    process.env.ACCOUNT_ID,
    results.envelopeId,
    { recipientViewRequest: viewRequest }
  );

  console.log("View results:\n", results.url);
  // console.log({envelopeId: envelopeId, redirectUrl: results.url})

  res.redirect(results.url);
});

app.get("/details", async (req, res) => {
  try {
    // Check if the access token is valid or generate a new one
    await checkToken(req, res);

    // Create an instance of the TemplatesApi using the access token
    let templatesApi = getTemplatesApi(req, res);

    // Get the template details by template ID
    let templateId = process.env.TEMPLATE_ID;
    let template = await templatesApi.get(process.env.ACCOUNT_ID, templateId);

    // Extract the required data from the template details
    const { documents, recipients } = template;
    const completedDocument = documents.find((doc) => doc.order === "1");
    const completedDocumentPath = completedDocument?.uri || "";

    const signers = recipients?.signers || [];
    const signer = signers.find((s) => s.roleName === "Applicant");
    const signingUrl = signer?.email
      ? `https://demo.docusign.net/Signing/?ti=${signer.email}`
      : "";

    res.redirect(signingUrl+completedDocumentPath);
  } catch (error) {
    console.error("Error fetching template details:", error);
    res.status(500).json({ error: "Failed to fetch template details" });
  }
});

function getTemplatesApi(req, res) {
  let dsApiClient = new docusign.ApiClient();
  dsApiClient.setBasePath(process.env.BASE_PATH);
  dsApiClient.addDefaultHeader(
    "Authorization",
    "Bearer " + req.session.access_token
  );
  return new docusign.TemplatesApi(dsApiClient);
}



function getEnvelopesApi(req, res) {
  let dsApiClient = new docusign.ApiClient();
  dsApiClient.setBasePath(process.env.BASE_PATH);
  dsApiClient.addDefaultHeader(
    "Authorization",
    "Bearer " + req.session.access_token
  );
  return new docusign.EnvelopesApi(dsApiClient);
}

function makeEnvelope(name, email, company, clientId) {
  let env = new docusign.EnvelopeDefinition();
  env.templateId = process.env.TEMPLATE_ID;

  let text = docusign.Text.constructFromObject({
    tabLabel: "Company-Name",
    value: company,
  });
  let tabs = docusign.Tabs.constructFromObject({
    textTabs: [text],
  });

  let signer1 = docusign.TemplateRole.constructFromObject({
    email: email,
    name: name,
    tabs: tabs,
    clientUserId: clientId,
    roleName: "Applicant",
  });

  env.templateRoles = [signer1];
  env.status = "sent"; // We want the envelope to be sent

  return env;
}

function generateUniqueId() {
  const { v4: uuidv4 } = require("uuid");
  return uuidv4();
}

function makeRecipientViewRequest(name, email, clientId) {
  let viewRequest = new docusign.RecipientViewRequest();

  viewRequest.returnUrl = "http://localhost:4000/success";
  viewRequest.authenticationMethod = "none";

  viewRequest.email = email;
  viewRequest.userName = name;
  viewRequest.clientUserId = clientId;

  return viewRequest;
}

async function checkToken(req, res) {
  if (req.session.access_token && req.session.expires_at > Date.now()) {
    console.log("token is valid", req.session.access_token);
  } else {
    console.log("generating new token");
    let dsApiClient = new docusign.ApiClient();
    dsApiClient.setBasePath(process.env.BASE_PATH);
    const results = await dsApiClient.requestJWTUserToken(
      process.env.INTEGRATION_KEY,
      process.env.USER_ID,
      "signature",
      fs.readFileSync(path.join(__dirname, "private.key")),
      2 * 3600
    );
    console.log(results.body);
    req.session.access_token = results.body.access_token;
    req.session.expires_at = Date.now() + (results.body.expires_in - 60) * 1000;
  }
}

app.get("/", async (req, res) => {
  await checkToken(req, res);
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/success", (req, res) => {
  const filePath = path.join(__dirname, "success", "success.html");
  res.sendFile(filePath);
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
