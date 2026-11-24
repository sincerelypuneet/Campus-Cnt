// backend/services/unifiedSearch.js

import { minuteOfDay, isValidDateKey, overlaps as computerLabOverlaps, isComputerLabBooking } from './computerLabs.js';
import {
  isComputerUnderMaintenance,
  isLabUnderMaintenance,
  isClassroomUnderMaintenance,
  maintenanceAppliesToSlot,
} from './labMaintenance.js';

const inactiveStatuses = new Set(['cancelled', 'canceled', 'rejected', 'denied', 'expired', 'completed', 'resolved']);
const unavailableStatuses = new Set(['unavailable', 'maintenance', 'closed', 'out of service', 'out-of-service']);

export function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function validateUnifiedSearch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Provide search criteria with date, start time, and end time.' };
  }

  const {
    type = 'all',
    resourceType = type,
    date,
    startTime,
    endTime,
    building = '',
    minCapacity,
    equipment = '',
    facilities = equipment,
    availableOnly = false,
    sortBy = 'availability',
    sortOrder = 'asc',
  } = input;

  const validTypes = ['all', 'classroom', 'computer_lab', 'computer'];
  const normalizedType = String(resourceType || 'all').trim().toLowerCase();
  if (!validTypes.includes(normalizedType)) {
    return { error: 'Resource type must be one of: all, classroom, computer_lab, computer.' };
  }

  if (!isValidDateKey(date) || date < localDateKey(new Date())) {
    return { error: 'Choose a valid date that is today or later.' };
  }

  const startMins = minuteOfDay(startTime);
  const endMins = minuteOfDay(endTime);
  if (startMins === null || endMins === null || startMins >= endMins) {
    return { error: 'Enter valid 24-hour times, with the end time after the start time.' };
  }

  let parsedMinCapacity = 1;
  if (minCapacity !== undefined && minCapacity !== null && String(minCapacity).trim() !== '') {
    parsedMinCapacity = Number(minCapacity);
    if (!Number.isInteger(parsedMinCapacity) || parsedMinCapacity < 1 || parsedMinCapacity > 10000) {
      return { error: 'Minimum capacity must be a whole number between 1 and 10000.' };
    }
  }

  if (building && (typeof building !== 'string' || building.length > 100)) {
    return { error: 'Building filter must be a string up to 100 characters.' };
  }

  if (facilities && (typeof facilities !== 'string' || facilities.length > 100)) {
    return { error: 'Equipment filter must be a string up to 100 characters.' };
  }

  const validSortBys = ['availability', 'capacity', 'name', 'type'];
  const normalizedSortBy = validSortBys.includes(String(sortBy).toLowerCase()) ? String(sortBy).toLowerCase() : 'availability';
  const defaultSortOrder = normalizedSortBy === 'capacity' ? 'desc' : 'asc';
  const normalizedSortOrder = input.sortOrder !== undefined
    ? (String(sortOrder).toLowerCase() === 'desc' ? 'desc' : 'asc')
    : defaultSortOrder;

  const isAvailableOnly = availableOnly === true || availableOnly === 'true' || availableOnly === 1 || availableOnly === '1';

  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(parsedDate);

  return {
    value: {
      resourceType: normalizedType,
      date,
      startTime,
      endTime,
      weekday,
      startMins,
      endMins,
      building: String(building || '').trim(),
      minCapacity: parsedMinCapacity,
      equipment: String(facilities || '').trim(),
      availableOnly: isAvailableOnly,
      sortBy: normalizedSortBy,
      sortOrder: normalizedSortOrder,
    },
  };
}

function isActive(record) {
  return record && record.active !== false && !inactiveStatuses.has(String(record.status || '').toLowerCase());
}

function overlapsInterval(startTime, endTime, queryStart, queryEnd) {
  const start = minuteOfDay(startTime);
  const end = minuteOfDay(endTime);
  if (start === null || end === null || end <= start) return true;
  return start < queryEnd && end > queryStart;
}

function overlapsRecord(record, queryStart, queryEnd) {
  let startTime = record.startTime;
  let endTime = record.endTime;
  if ((!startTime || !endTime) && typeof record.timeSlot === 'string') {
    const match = /^\s*(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})\s*$/.exec(record.timeSlot);
    if (match) [, startTime, endTime] = match;
  }
  if (!startTime || !endTime) return true;
  return overlapsInterval(startTime, endTime, queryStart, queryEnd);
}

function appliesToDate(record, date, weekday, fallbackToAllDays = false) {
  if (record.date) return record.date === date;
  if (record.startDate || record.endDate) {
    return (!record.startDate || record.startDate <= date) && (!record.endDate || record.endDate >= date);
  }
  if (record.day) return String(record.day).toLowerCase() === weekday.toLowerCase();
  return fallbackToAllDays;
}

function matchesRoom(record, roomId) {
  return (record.classroomId || record.roomId) === roomId;
}

export function searchUnifiedResources({
  criteria,
  classrooms = [],
  timetable = [],
  classroomReservations = [],
  classroomMaintenance = [],
  maintenance = [],
  laboratories = [],
  labBookings = [],
}) {
  const {
    resourceType,
    date,
    startTime,
    endTime,
    weekday,
    startMins,
    endMins,
    building,
    minCapacity,
    equipment,
    availableOnly,
    sortBy,
    sortOrder,
  } = criteria;

  const slot = { date, startTime, endTime };
  const allClassroomMaintenance = [
    ...(Array.isArray(classroomMaintenance) ? classroomMaintenance : []),
    ...(Array.isArray(maintenance) ? maintenance.filter((m) => m.type === 'classroom') : []),
  ];

  const results = [];

  // ==========================================
  // 1. CLASSROOMS
  // ==========================================
  if (resourceType === 'all' || resourceType === 'classroom') {
    for (const room of classrooms) {
      if (!room || !room.id || room.active === false) continue;

      const roomStatus = room.availabilityStatus || room.availability || room.status;
      const isRoomDisabled = unavailableStatuses.has(String(roomStatus || '').toLowerCase());

      const capacity = Number(room.seatingCapacity ?? room.capacity ?? 0);
      const roomBuilding = String(room.building || '');
      const roomFloor = room.floorNumber ?? room.floor ?? null;
      const roomNumber = room.roomNumber || room.classroomNumber || room.name || 'Room';
      const roomName = room.name || `Room ${roomNumber}`;
      const facilitiesList = Array.isArray(room.facilities)
        ? room.facilities
        : Array.isArray(room.resources)
        ? room.resources
        : [room.facilities || room.resources].filter(Boolean);

      // Filter: Building
      if (building && roomBuilding.toLowerCase() !== building.toLowerCase()) {
        continue;
      }

      // Filter: Capacity
      if (capacity < minCapacity) {
        continue;
      }

      // Filter: Equipment
      if (equipment) {
        const matchesEq = facilitiesList.some((item) =>
          String(item).toLowerCase().includes(equipment.toLowerCase())
        );
        if (!matchesEq) continue;
      }

      // Determine availability
      let availability = 'available';
      let statusLabel = 'Available';
      let maintenanceReason = null;

      if (isRoomDisabled) {
        availability = 'maintenance';
        statusLabel = 'Unavailable';
      } else {
        // Check maintenance
        const maintRecord = allClassroomMaintenance.find((m) =>
          isActive(m) &&
          matchesRoom(m, room.id) &&
          appliesToDate(m, date, weekday, true) &&
          overlapsRecord(m, startMins, endMins)
        );

        if (maintRecord) {
          availability = 'maintenance';
          statusLabel = 'Under Maintenance';
          maintenanceReason = maintRecord.reason || 'Scheduled maintenance';
        } else {
          // Check timetable conflict
          const timetableConflict = timetable.find((entry) =>
            isActive(entry) &&
            matchesRoom(entry, room.id) &&
            appliesToDate(entry, date, weekday) &&
            overlapsRecord(entry, startMins, endMins)
          );

          if (timetableConflict) {
            availability = 'occupied';
            statusLabel = 'Class in Session';
          } else {
            // Check reservation conflict
            const resConflict = classroomReservations.find((res) =>
              isActive(res) &&
              matchesRoom(res, room.id) &&
              appliesToDate(res, date, weekday) &&
              overlapsRecord(res, startMins, endMins)
            );

            if (resConflict) {
              availability = 'occupied';
              statusLabel = 'Reserved';
            }
          }
        }
      }

      if (availableOnly && availability !== 'available') {
        continue;
      }

      const locationParts = [
        roomBuilding || 'Campus',
        roomFloor !== null ? `Floor ${roomFloor}` : null,
        `Room ${roomNumber}`,
      ].filter(Boolean);

      results.push({
        id: room.id,
        name: roomName,
        identifier: roomNumber,
        resourceType: 'classroom',
        typeLabel: room.roomType || 'Classroom',
        building: roomBuilding,
        floor: roomFloor,
        location: locationParts.join(' · '),
        capacity,
        specifications: facilitiesList.join(' · ') || 'Standard classroom facilities',
        facilities: facilitiesList,
        slot: { date, startTime, endTime, weekday },
        availability,
        statusLabel,
        maintenanceReason,
        bookingAction: availability === 'available' ? {
          type: 'reserve_classroom',
          label: 'Reserve Classroom',
          endpoint: '/api/student/classroom-reservations',
          method: 'POST',
          payload: { classroomId: room.id, date, startTime, endTime },
        } : null,
      });
    }
  }

  // ==========================================
  // 2. COMPUTER LABORATORIES & WORKSTATIONS
  // ==========================================
  const activeLabs = laboratories.filter((lab) => lab && lab.id && lab.active !== false);

  for (const lab of activeLabs) {
    const labBuilding = String(lab.building || '');
    const labFloor = lab.floor ?? null;
    const labRoom = lab.room || lab.roomNumber || null;
    const category = lab.category || lab.type || 'LPC';
    const isHpc = category === 'HPC';
    const labName = lab.name || (isHpc ? 'High Performance Computing Lab' : 'Computer Laboratory');
    const labEquipment = Array.isArray(lab.equipment)
      ? lab.equipment
      : Array.isArray(lab.resources)
      ? lab.resources
      : [lab.equipment || lab.resources].filter(Boolean);

    const computers = Array.isArray(lab.computers)
      ? lab.computers
      : Array.isArray(lab.pcs)
      ? lab.pcs
      : [];
    const activePcs = computers.filter((c) => c && c.id && c.active !== false);
    const labCapacity = Number(lab.capacity ?? (activePcs.length || 1));

    // Lab building match
    const matchesLabBuilding = !building || labBuilding.toLowerCase() === building.toLowerCase();

    // Check whole lab maintenance
    const isLabMaint = isLabUnderMaintenance(lab.id, slot, maintenance);
    let labMaintReason = null;
    if (isLabMaint) {
      const maintItem = maintenance.find((m) =>
        m.type === 'lab' &&
        m.labId === lab.id &&
        (!m.computerId || m.computerId === 'all') &&
        maintenanceAppliesToSlot(m, slot)
      );
      labMaintReason = maintItem?.reason || 'Lab maintenance in progress';
    }

    // ------------------------------------------
    // A. COMPUTER LAB AS A WHOLE (resourceType === 'all' || 'computer_lab')
    // ------------------------------------------
    if ((resourceType === 'all' || resourceType === 'computer_lab') && matchesLabBuilding) {
      // Check capacity
      if (labCapacity >= minCapacity) {
        // Check equipment
        let matchesEq = true;
        if (equipment) {
          matchesEq = labEquipment.some((item) => String(item).toLowerCase().includes(equipment.toLowerCase()));
        }

        if (matchesEq) {
          let labAvailability = 'available';
          let labStatusLabel = 'Available';

          if (isLabMaint) {
            labAvailability = 'maintenance';
            labStatusLabel = 'Under Maintenance';
          } else if (activePcs.length > 0) {
            // Check PC availabilities
            let freeCount = 0;
            let maintCount = 0;
            for (const pc of activePcs) {
              const pcMaint = isComputerUnderMaintenance(pc.id, lab.id, slot, maintenance);
              if (pcMaint) {
                maintCount++;
                continue;
              }
              const isBooked = labBookings.some((b) =>
                isComputerLabBooking(b) &&
                b.labId === lab.id &&
                b.computerId === pc.id &&
                computerLabOverlaps(b, slot)
              );
              if (!isBooked) freeCount++;
            }

            if (freeCount > 0) {
              if (isHpc) {
                labAvailability = 'request_required';
                labStatusLabel = `${freeCount} HPC PCs Available (Approval Required)`;
              } else {
                labAvailability = 'available';
                labStatusLabel = `${freeCount} of ${activePcs.length} PCs Free`;
              }
            } else if (maintCount === activePcs.length) {
              labAvailability = 'maintenance';
              labStatusLabel = 'Under Maintenance';
            } else {
              labAvailability = 'occupied';
              labStatusLabel = 'Fully Booked';
            }
          } else {
            // Lab without individual PCs defined
            const wholeLabBooking = labBookings.some((b) =>
              isActive(b) &&
              b.labId === lab.id &&
              b.date === date &&
              overlapsInterval(b.startTime || (b.timeSlot?.split('-')[0]), b.endTime || (b.timeSlot?.split('-')[1]), startMins, endMins)
            );
            if (wholeLabBooking) {
              labAvailability = 'occupied';
              labStatusLabel = 'Booked';
            } else if (isHpc) {
              labAvailability = 'request_required';
              labStatusLabel = 'Request Required (HPC)';
            } else {
              labAvailability = 'available';
              labStatusLabel = 'Available';
            }
          }

          if (!availableOnly || labAvailability === 'available') {
            const locationParts = [
              labBuilding || 'Campus',
              labFloor !== null ? `Floor ${labFloor}` : null,
              labRoom ? `Room ${labRoom}` : null,
            ].filter(Boolean);

            results.push({
              id: lab.id,
              name: labName,
              identifier: labRoom || lab.id,
              resourceType: 'computer_lab',
              typeLabel: isHpc ? 'HPC Laboratory' : 'Computer Laboratory',
              category,
              building: labBuilding,
              floor: labFloor,
              location: locationParts.join(' · '),
              capacity: labCapacity,
              specifications: labEquipment.join(' · ') || 'Standard laboratory equipment',
              facilities: labEquipment,
              slot: { date, startTime, endTime, weekday },
              availability: labAvailability,
              statusLabel: labStatusLabel,
              maintenanceReason: isLabMaint ? labMaintReason : null,
              bookingAction: labAvailability === 'available' || labAvailability === 'request_required' ? (
                isHpc ? {
                  type: 'request_hpc',
                  label: 'Request HPC Lab Access',
                  endpoint: '/api/student/lab-requests',
                  method: 'POST',
                  payload: { labId: lab.id, date, startTime, endTime },
                } : {
                  type: 'view_lab_pcs',
                  label: 'View Lab Computers',
                  url: `computer-labs.html?lab=${lab.id}`,
                }
              ) : null,
            });
          }
        }
      }
    }

    // ------------------------------------------
    // B. INDIVIDUAL COMPUTERS / WORKSTATIONS (resourceType === 'all' || 'computer')
    // ------------------------------------------
    if ((resourceType === 'all' || resourceType === 'computer') && matchesLabBuilding) {
      for (const pc of activePcs) {
        // Individual PC capacity is 1
        if (minCapacity > 1) continue;

        const pcSpecs = pc.specs || pc.specification || pc.description || '';
        const combinedFacilities = [pcSpecs, ...labEquipment].filter(Boolean);

        if (equipment) {
          const matches = combinedFacilities.some((item) =>
            String(item).toLowerCase().includes(equipment.toLowerCase())
          ) || String(pc.name || '').toLowerCase().includes(equipment.toLowerCase());
          if (!matches) continue;
        }

        let pcAvailability = 'available';
        let pcStatusLabel = 'Available';
        let pcMaintenanceReason = null;

        if (isLabMaint) {
          pcAvailability = 'maintenance';
          pcStatusLabel = 'Under Maintenance (Lab)';
          pcMaintenanceReason = labMaintReason;
        } else {
          const pcUnderMaint = isComputerUnderMaintenance(pc.id, lab.id, slot, maintenance);
          if (pcUnderMaint) {
            pcAvailability = 'maintenance';
            pcStatusLabel = 'Under Maintenance';
            const item = maintenance.find((m) =>
              m.type === 'lab' &&
              m.labId === lab.id &&
              (m.computerId === pc.id || m.computerId === 'all') &&
              maintenanceAppliesToSlot(m, slot)
            );
            pcMaintenanceReason = item?.reason || 'Workstation maintenance';
          } else {
            const booking = labBookings.find((b) =>
              isComputerLabBooking(b) &&
              b.labId === lab.id &&
              b.computerId === pc.id &&
              computerLabOverlaps(b, slot)
            );

            if (booking) {
              pcAvailability = 'occupied';
              pcStatusLabel = 'Occupied';
            } else if (isHpc) {
              pcAvailability = 'request_required';
              pcStatusLabel = 'Available (Approval Required)';
            }
          }
        }

        if (availableOnly && pcAvailability !== 'available') {
          continue;
        }

        const pcName = pc.name || pc.label || `Workstation ${pc.id}`;
        const locationParts = [
          labBuilding || 'Campus',
          labFloor !== null ? `Floor ${labFloor}` : null,
          labRoom ? `Room ${labRoom}` : null,
          labName,
        ].filter(Boolean);

        results.push({
          id: `${lab.id}__${pc.id}`,
          name: `${labName} - ${pcName}`,
          identifier: `${pcName} (${labName})`,
          computerId: pc.id,
          labId: lab.id,
          resourceType: 'computer',
          typeLabel: isHpc ? 'HPC Workstation' : 'LPC Workstation',
          category,
          building: labBuilding,
          floor: labFloor,
          location: locationParts.join(' · '),
          capacity: 1,
          specifications: combinedFacilities.join(' · ') || (isHpc ? 'High-Performance Workstation' : 'Standard Workstation'),
          facilities: combinedFacilities,
          slot: { date, startTime, endTime, weekday },
          availability: pcAvailability,
          statusLabel: pcStatusLabel,
          maintenanceReason: pcMaintenanceReason,
          bookingAction: pcAvailability === 'available' ? {
            type: 'book_computer',
            label: 'Book Workstation',
            endpoint: '/api/student/computer-lab-bookings',
            method: 'POST',
            payload: { labId: lab.id, computerId: pc.id, date, startTime, endTime },
          } : (isHpc && pcAvailability === 'request_required' ? {
            type: 'request_hpc',
            label: 'Request HPC Workstation',
            endpoint: '/api/student/lab-requests',
            method: 'POST',
            payload: { labId: lab.id, date, startTime, endTime },
          } : null),
        });
      }
    }
  }

  // ==========================================
  // 3. SORTING
  // ==========================================
  const availabilityRank = {
    available: 1,
    request_required: 2,
    occupied: 3,
    maintenance: 4,
  };

  results.sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'availability') {
      const rankA = availabilityRank[a.availability] || 99;
      const rankB = availabilityRank[b.availability] || 99;
      comparison = rankA - rankB;
      if (comparison === 0) {
        comparison = b.capacity - a.capacity;
      }
    } else if (sortBy === 'capacity') {
      comparison = a.capacity - b.capacity;
    } else if (sortBy === 'name') {
      comparison = a.name.localeCompare(b.name);
    } else if (sortBy === 'type') {
      comparison = a.resourceType.localeCompare(b.resourceType) || a.name.localeCompare(b.name);
    }

    if (sortOrder === 'desc') {
      comparison = -comparison;
    }
    return comparison || a.name.localeCompare(b.name);
  });

  return results;
}
