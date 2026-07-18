const API_URL =
  `${window.location.protocol}//${window.location.hostname}:8000`;

let responseHandler = null;

export function initializeApi(apiResponseHandler) {
  if (typeof apiResponseHandler !== "function") {
    throw new TypeError(
      "initializeApi requires an API response handler function.",
    );
  }

  responseHandler = apiResponseHandler;
}

export async function callApi(route, bodyData = null) {
  if (!responseHandler) {
    throw new Error("API module has not been initialized.");
  }

  const options = {
    method: "POST",
    headers: {},
  };

  if (bodyData !== null) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(bodyData);
  }

  let response;

  try {
    response = await fetch(API_URL + route, options);
  } catch (error) {
    throw new Error(`Unable to reach the server: ${error.message}`);
  }

  const text = await response.text();
  let apiResponse;

  try {
    apiResponse = JSON.parse(text);
  } catch {
    throw new Error(`Server returned invalid JSON: ${text}`);
  }

  await responseHandler(apiResponse);
}
