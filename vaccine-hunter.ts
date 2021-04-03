import got from 'got';
const fs = require('fs');
const haversine = require('haversine');

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
	city: string;
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

interface Config {
	centerCoords: HaversineCoords
}

const config: Config = JSON.parse(fs.readFileSync('config.json', 'utf8'))

const centerCoords = config.centerCoords

function translateCoords(vaccineSpotterCoords: number[]): HaversineCoords {
  return {
    longitude: vaccineSpotterCoords[0],
    latitude: vaccineSpotterCoords[1],
  }
}

got('https://www.vaccinespotter.org/api/v0/states/IL.json').then(resp => {
	let parsed: VSResponse = JSON.parse(resp.body);
	let locations = parsed.features;
	let vaccinesAvailable = locations.filter(location => location.properties.appointments_available)
	function locationsFilteredToRadius(locations: VSLocation[], radius: number) {
		return locations.filter(location => {
			let distanceMiles = haversine(centerCoords, translateCoords(location.geometry.coordinates), {unit: 'mile'})
			return distanceMiles < radius
		})
	}

	let favoriteLocations = locationsFilteredToRadius(locations, 5).
	  filter(loc => loc.properties.city.toLocaleLowerCase() !== 'chicago')

	let logRecord = {
		success: true,
		time: new Date().toISOString(),
		center: centerCoords,
		stats: {
			totalLocations: locations.length,
			locationsWithAvailability: vaccinesAvailable.length,
			favoriteLocationsWithAvailability: favoriteLocations.filter(loc => loc.properties.appointments_available).length,
			locationsWithAvailabilityWithin5Miles: locationsFilteredToRadius(vaccinesAvailable, 5).length,
			locationsWithAvailabilityWithin10Miles: locationsFilteredToRadius(vaccinesAvailable, 10).length,
			locationsWithAvailabilityWithin25Miles: locationsFilteredToRadius(vaccinesAvailable, 25).length,
			locationsWithAvailabilityWithin50Miles: locationsFilteredToRadius(vaccinesAvailable, 50).length,
		},
		favoriteLocationsStatus: favoriteLocations.map(location => {
			return {
				id: location.properties.id,
				name: location.properties.name,
				address: `${location.properties.address}, ${location.properties.city}, ${location.properties.state}`,
				carries_vaccine: location.properties.carries_vaccine,
				appointment_vaccine_types: location.properties.appointment_vaccine_types,
				appointments_available_all_doses: location.properties.appointments_available_all_doses,
				appointments_available_2nd_dose_only: location.properties.appointments_available_2nd_dose_only,
				appointment_dates: new Set(location.properties.appointments?.map(appt => new Date(appt.time).toLocaleDateString('en-us'))),
			}
		})
	}

	console.log(JSON.stringify(logRecord, null, 2))
}).catch(error => {
	let logRecord = {
		success: false,
		time: new Date().toISOString(),
		center: centerCoords,
		errorStatus: error.response.statusCode,
		errorMessage: error.response.statusMessage,
	}
	console.log(JSON.stringify(logRecord, null, 2))
});
