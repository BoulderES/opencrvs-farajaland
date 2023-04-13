/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * OpenCRVS is also distributed under the terms of the Civil Registration
 * & Healthcare Disclaimer located at http://opencrvs.org/license.
 *
 * Copyright (C) The OpenCRVS Authors. OpenCRVS and the OpenCRVS
 * graphic logo are (registered/a) trademark(s) of Plan International.
 */
import {
  INGROUPE_UIN_MANAGEMENT_URL,
  OSIA_JWT,
  OSIA_UIN_REQUEST_AUTHORITY,
  OSIA_UIN_MANAGEMENT_URL
} from '@countryconfig/constants'
import { CONFIG_HOST } from '@countryconfig/data-generator/constants'
import { generateRegistrationNumber } from '@countryconfig/features/generateRegistrationNumber/service'
import {
  EVENT_TYPE,
  getChildDetailsFromBundleForOsiaUinGeneration,
  getEventType,
  getTaskResource,
  getTrackingIdFromTaskResource
} from '@countryconfig/features/utils'
import fetch from 'node-fetch'
import { URL, URLSearchParams } from 'url'

interface IIntegration {
  name: string
  status: string
  integratingSystemType: 'MOSIP' | 'OSIA' | 'OTHER'
}

interface IOsiaUinPayload {
  firstName: string
  lastName: string
  dateOfBirth: string
}

interface IOsiaIngroupeUinPayload {
  firstName: string
  lastName: string
  legalName?: string
  gender: string
  birthDate: string
  birthPlace: string
  authority: string
}
interface IOsiaIngroupeUinResponse {
  success: boolean
  message: string
  data: string
}

interface IAdditionalPropsForWebhookResponse {
  OSIA_UIN_VID_NID?: string
}

export async function createWebHookResponseFromBundle(
  bundle: fhir.Bundle,
  integrations: IIntegration[]
) {
  const taskResource = getTaskResource(bundle)
  const additionalPropertiesOfResponse: IAdditionalPropsForWebhookResponse = {}

  if (!taskResource || !taskResource.extension) {
    throw new Error(
      'Failed to validate registration: could not find task resource in bundle or task resource had no extensions'
    )
  }

  const trackingId = getTrackingIdFromTaskResource(taskResource)

  const person = getChildDetailsFromBundleForOsiaUinGeneration(bundle)

  if (getEventType(bundle) === EVENT_TYPE.DEATH) {
    const OsiaIntegrationEnabled = integrations.some(
      (integration) => integration.integratingSystemType === 'OSIA'
    )
    if (OsiaIntegrationEnabled) {
      const OSIA_UIN = await generarateOsiaUinNidVid(person, trackingId)
      additionalPropertiesOfResponse.OSIA_UIN_VID_NID = OSIA_UIN
    }
  }

  return {
    trackingId,
    registrationNumber: await generateRegistrationNumber(trackingId),
    ...additionalPropertiesOfResponse
  }
}

export async function getIntegrationConfig(
  token: string
): Promise<IIntegration[]> {
  const res = await fetch(new URL('/integrationConfig', CONFIG_HOST).href, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      authorization: token
    }
  })

  if (!res.ok) {
    throw new Error(`Could not fetch config, ${res.statusText} ${res.status}`)
  }

  return res.json()
}

export async function generarateOsiaUinNidVid(
  person: fhir.Patient,
  trackingId: string
): Promise<string> {
  const personName = person?.name?.find((n: fhir.HumanName) => n.use === 'en')
  const firstName = (personName?.given && personName?.given[0]) || ''
  const lastName = (personName?.family && personName?.family[0]) || ''
  const dateOfBirth = person.birthDate || ''
  const gender = person?.gender || ''

  if (
    INGROUPE_UIN_MANAGEMENT_URL &&
    OSIA_UIN_MANAGEMENT_URL === INGROUPE_UIN_MANAGEMENT_URL
  ) {
    const ingroupUinResponse = await generateInGroupeSpecificOsiaUin({
      firstName,
      lastName,
      legalName: '',
      gender: gender.toUpperCase(),
      birthDate: dateOfBirth,
      birthPlace: 'XXX',
      authority: OSIA_UIN_REQUEST_AUTHORITY
    })

    return ingroupUinResponse.data
  }

  return await generateGenericOsiaUin(
    { firstName, lastName, dateOfBirth },
    trackingId
  )
}

export async function generateGenericOsiaUin(
  payload: IOsiaUinPayload,
  trackingId: string
): Promise<string> {
  const url = new URL('/v1/uin', OSIA_UIN_MANAGEMENT_URL)
  url.search = new URLSearchParams({
    transactionId: trackingId
  }).toString()

  const res = await fetch(url.href, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${OSIA_JWT}`
    },
    body: JSON.stringify(payload)
  })

  if (!res.ok) {
    const errorData = await res.json()
    throw new Error(
      `Could not generate OSIA_UIN_VID_NID, ${res.statusText} ${res.status} ${errorData.message} `
    )
  }

  return res.text()
}

export async function generateInGroupeSpecificOsiaUin(
  payload: IOsiaIngroupeUinPayload
): Promise<IOsiaIngroupeUinResponse> {
  if (!OSIA_UIN_MANAGEMENT_URL) {
    throw new Error(`Osia uin management url not found`)
  }
  const res = await fetch(OSIA_UIN_MANAGEMENT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${OSIA_JWT}`
    },
    body: JSON.stringify(payload)
  })

  if (!res.ok) {
    const errorData = await res.json()
    throw new Error(
      `Could not generate OSIA_UIN_VID_NID for Ingroupe solution, ${res.statusText} ${res.status} ${errorData.message} `
    )
  }

  return res.json()
}
