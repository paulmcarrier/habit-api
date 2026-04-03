import EventKit
import Foundation

let eventStore = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)

eventStore.requestAccess(to: .event) { (granted, error) in
    guard granted else {
        print("Access denied") // Simpler error message
        exit(1)
    }
    
    let currentDate = Date()
    let startOfDay = Calendar.current.startOfDay(for: currentDate)
    let endOfDay = Calendar.current.date(byAdding: .day, value: 1, to: startOfDay)! // Start of the next day

    // Get specific calendars: "Family" and "Paul Personal"
    let calendars = eventStore.calendars(for: .event).filter {
        $0.title == "Family" || $0.title == "Paul Personal"
    }
    
    if calendars.isEmpty {
        print("[]")
        semaphore.signal()
        return
    }
    
    // Create predicate for events within the current day
    let predicate = eventStore.predicateForEvents(withStart: startOfDay, end: endOfDay, calendars: calendars)
    let events = eventStore.events(matching: predicate)
    
    // Map events and sort by start date
    let result = events
        .sorted { $0.startDate < $1.startDate }
        .map { event in
            return [
                "title": event.title ?? "No Title",
                "start": ISO8601DateFormatter().string(from: event.startDate),
                "calendar": event.calendar.title
            ]
        }
    
    if let jsonData = try? JSONSerialization.data(withJSONObject: result, options: []),
       let jsonString = String(data: jsonData, encoding: .utf8) {
        print(jsonString)
    }
    
    semaphore.signal()
}

semaphore.wait()
