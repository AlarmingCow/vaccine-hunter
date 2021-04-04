import got from 'got';
const fs = require('fs');
const haversine = require('haversine');
const _ = require('lodash');
const { exec } = require("child_process");
import { LocalDate, LocalTime, ZonedDateTime, LocalDateTime, ZoneId } from '@js-joda/core'
import '@js-joda/timezone'

interface HaversineCoords {
	latitude: number;
	longitude: number;
}

interface VSGeometry {
	type: string;
	coordinates: number[];
}

interface VSAppointment {
	time: string;  // ISO-8601 offset datetime e.g "2021-04-05T15:45:00.000-05:00"
	type: string; // 'Johnson & Johnson', 'Pfizer', 'Pfizer - 2nd Dose Only', 'Moderna', 'Moderna - 2nd Dose Only'
	vaccine_types: string[]; // 'moderna', 'pfizer', 'jj'
	appointment_types: string[]; // 'all_doses', '2nd_dose_only'
}

interface VSAppointmentTypes {
	all_doses: boolean;
	'2nd_dose_only': boolean;
	unknown: true;
}

interface VSAppointmentVaccineTypes {
	moderna?: boolean;
	pfizer?: boolean;
	jj?: boolean;
}

interface VSLocationProperties {
	id: number;
	url: string;
	city?: string;
	name: string;
	state: string;
	address: string;
	provider: string;
	time_zone: string;
	postal_code: string;
	appointments?: VSAppointment[];
	provider_brand: string;
	carries_vaccine: boolean;
	appointment_types: VSAppointmentTypes;
	provider_brand_id: number;
	provider_brand_name: string;
	provider_location_id: string;
	appointments_available: boolean;
	appointment_vaccine_types: VSAppointmentVaccineTypes;
	appointments_last_fetched: string;
	appointments_last_modified: string;
	appointments_available_all_doses: boolean;
	appointments_available_2nd_dose_only: boolean;
}

interface VSLocation {
	type: string;
	geometry: VSGeometry;
	properties: VSLocationProperties;
	metadata: {};
}

interface VSResponse {
	type: string;
	features: VSLocation[];
}

interface AlertWindow {
	start: string; // 24-hour local time, e.g. 07:00
	end: string; // 24-hour local time, e.g. 23:00
	tz: string; // tz database timezone, e.g. America/New_York
}

interface RegistrantConfig {
	alertWindow: AlertWindow;
	centerCoords: HaversineCoords;
	cityExclusions: string[];
	eligibilityDate: string;
	notificationType?: 'sms' | 'imessage';
	phone: string;
	radiusMiles: number;
	state: string;
}

interface Config {
	registrants: RegistrantConfig[];
}

const config: Config = JSON.parse(fs.readFileSync('config.json', 'utf8'))

// Don't want to alert one person about appointments at the same location on the same day more than once
interface AlertHistoryEntry {
	locationId: number;
	localDate: string; // ISO-8601 local date e.g. 2021-04-03
	phone: string;
}
let alertHistory: AlertHistoryEntry[]
try {
	alertHistory = JSON.parse(fs.readFileSync('alert_history.json', 'utf8'))
} catch (err) {
	alertHistory = []
}

function translateCoords(vaccineSpotterCoords: number[]): HaversineCoords {
  return {
    longitude: vaccineSpotterCoords[0],
    latitude: vaccineSpotterCoords[1],
  }
}

/*
 * AWS setup
 */
// Load the AWS SDK for Node.js
var AWS = require('aws-sdk');
// Set region
AWS.config.update({region: 'us-east-1'});

function sendAlerts(alerts, config: RegistrantConfig) {
	if (config.notificationType === 'sms') {
		alerts.forEach(alert => {
			var params = {
				Message: alert.alertText,
				PhoneNumber: config.phone,
			};
			// Create promise and SNS service object
			var publishTextPromise = new AWS.SNS({apiVersion: '2010-03-31'}).publish(params).promise();

			// Handle promise's fulfilled/rejected states
			publishTextPromise.then(data => {}).catch(err => console.error(err, err.stack));
		})
	} else if (config.notificationType === 'imessage') {
		alerts.forEach(alert => {
			exec(`osascript -e 'tell application "Messages" to send "${alert.alertText}" to buddy "${config.phone}"'`)
		})
	}
}

config.registrants.filter(registrant => { // only run alerts within the registrant's alert window
	let startTime = ZonedDateTime.of(
		LocalDate.now(),
		LocalTime.parse(registrant.alertWindow.start),
		ZoneId.of(registrant.alertWindow.tz)
	);
	let endTime = ZonedDateTime.of(
		LocalDate.now(),
		LocalTime.parse(registrant.alertWindow.end),
		ZoneId.of(registrant.alertWindow.tz)
	);
	let now = ZonedDateTime.now(ZoneId.of(registrant.alertWindow.tz))
	return startTime.isBefore(now) && endTime.isAfter(now)
}).forEach(registrant => {
	got(`https://www.vaccinespotter.org/api/v0/states/${registrant.state}.json`).then(resp => {
		let parsed: VSResponse = JSON.parse(resp.body);
		let locations = parsed.features;
		let vaccinesAvailable = locations.filter(location => location.properties.appointments_available)
		function locationsFilteredToRadius(locations: VSLocation[], radius: number) {
			return locations.filter(location => {
				let distanceMiles = haversine(registrant.centerCoords, translateCoords(location.geometry.coordinates), {unit: 'mile'})
				return distanceMiles < radius
			})
		}

		let favoriteLocations = locationsFilteredToRadius(locations, registrant.radiusMiles).
			filter(loc => registrant.cityExclusions.indexOf(loc.properties.city?.toLocaleLowerCase()) === -1)

		let alerts = favoriteLocations.filter(loc => loc.properties.appointments_available).map(loc => {
			let address = `${loc.properties.address}, ${loc.properties.city}, ${loc.properties.state}`
			let appointmentDates: Date[]
			let appointmentDatesFormatted: string[]
			if (loc.properties.appointments?.length > 0) {
				appointmentDates = _.uniqBy(loc.properties.appointments?.map(appt => new Date(appt.time)), date => date.toLocaleDateString('en-us'))
				appointmentDatesFormatted = appointmentDates.map(date => date.toLocaleDateString('en-us'))
			} else {
				appointmentDates = null
				appointmentDatesFormatted = null
			}
			return {
				locationId: loc.properties.id,
				name: loc.properties.name,
				address: address,
				appointment_vaccine_types: loc.properties.appointment_vaccine_types,
				appointments_available_all_doses: loc.properties.appointments_available_all_doses,
				appointments_available_2nd_dose_only: loc.properties.appointments_available_2nd_dose_only,
				appointment_dates_formatted: appointmentDatesFormatted,
				appointment_dates: appointmentDates,
				alertText: `New appointments are available! 💉
Location name: ${loc.properties.name}
Address: ${address}
Dates: ${appointmentDatesFormatted ? appointmentDatesFormatted : 'Not available'}
URL: ${loc.properties.url}`
			}
		}).filter(alert => { // eligibility filter
			let eligibilityDate = new Date(registrant.eligibilityDate)
			if (alert.appointment_dates) {
				return _.findIndex(alert.appointment_dates, date => date >= eligibilityDate) > -1
			} else {
				// eligibility cannot be determined, assume true if eligibility date < today
				return eligibilityDate <= new Date()
			}
		}).filter(alert => { // non-repeating alert filter
			let alertHistoryEntries: AlertHistoryEntry[] 
			if (alert.appointment_dates_formatted) {
				alertHistoryEntries= alert.appointment_dates_formatted.map(localDate => {
					return {
						locationId: alert.locationId,
						localDate: localDate,
						phone: registrant.phone
					}
				})
			} else {
				alertHistoryEntries = [{
					locationId: alert.locationId,
					localDate: new Date().toLocaleDateString('en-us'),
					phone: registrant.phone
				}]
			}
			let newAlerts = _.differenceWith(alertHistoryEntries, alertHistory, _.isEqual)
			newAlerts.forEach(element => alertHistory.push(element));
			return newAlerts.length > 0
		})

		let logRecord = {
			success: true,
			time: new Date().toISOString(),
			center: registrant.centerCoords,
			stats: {
				totalLocations: locations.length,
				locationsWithAvailability: vaccinesAvailable.length,
				favoriteLocationsWithAvailability: favoriteLocations.filter(loc => loc.properties.appointments_available).length,
				locationsWithAvailabilityWithin5Miles: locationsFilteredToRadius(vaccinesAvailable, 5).length,
				locationsWithAvailabilityWithin10Miles: locationsFilteredToRadius(vaccinesAvailable, 10).length,
				locationsWithAvailabilityWithin25Miles: locationsFilteredToRadius(vaccinesAvailable, 25).length,
				locationsWithAvailabilityWithin50Miles: locationsFilteredToRadius(vaccinesAvailable, 50).length,
				locationsWithAvailabilityWithin100Miles: locationsFilteredToRadius(vaccinesAvailable, 100).length,
			},
			alerts: alerts,
		}

		sendAlerts(alerts, registrant)

		fs.writeFile('alert_history.json', JSON.stringify(alertHistory), (err) => {})

		console.log(JSON.stringify(logRecord, null, 2))
	}).catch(error => {
		if (error.response) {
			let logRecord= {
				success: false,
				time: new Date().toISOString(),
				center: registrant.centerCoords,
				errorStatus: error.response.statusCode,
				errorMessage: error.response.statusMessage,
			}
			console.log(JSON.stringify(logRecord, null, 2))
		} else {
			console.log(error)
		}
	});
})
